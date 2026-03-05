import { Injectable } from '@angular/core';
import { bubbles, BubbleTemplate, Option } from '../data/bubble-template';

export interface Point {
  x: number;
  y: number;
}

export interface Marker {
  center: Point;
  rect: { x: number, y: number, w: number, h: number };
}

@Injectable({ providedIn: 'root' })
export class OmrLiteService {
  // Config matching bubble-template.ts
  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131;
  readonly FILL_THRESHOLD = 0.35; // 35% darkness threshold for Lite Engine

  // Expected marker positions in template
  readonly TEMPLATE_MARKERS: Point[] = [
    { x: 42.5, y: 42.5 },   // TL (center of 45x45 rect at 20,20)
    { x: 757.5, y: 42.5 },  // TR
    { x: 757.5, y: 1088.5 }, // BR
    { x: 42.5, y: 1088.5 }  // BL
  ];

  /**
   * Main entry point: process a canvas frame and return results.
   */
  processFrame(canvas: HTMLCanvasElement, answerKey: string[]): { gradingResults: any[]; studentHash?: number | null } {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get canvas context');

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. Prefer quadrant marker detection (reduces false positives from filled bubbles)
    let markersToUse: Point[] = [];
    const quadMarkers = this.detectMarkers(data, width, height);
    if (quadMarkers.length === 4) {
      markersToUse = quadMarkers.map(m => m.center);
    } else {
      // 2. Fallback: GLOBAL SEARCH for markers (Find markers ANYWHERE in the image)
      const allMarkers = this.findAllMarkersGlobal(data, width, height);
      const bestRect = this.findBestSheetRectangle(allMarkers);
      if (bestRect && bestRect.length === 4) {
        markersToUse = bestRect;
      } else {
        throw new Error(`Sheet not fully visible. Ensure all 4 corner markers are in the photo.`);
      }
    }

    // 3. Compute Perspective Transform
    const sortedMarkers = this.sortCorners(markersToUse);
    const transform = this.getPerspectiveTransform(this.TEMPLATE_MARKERS, sortedMarkers);

    // 4. Decode student identity code (if present)
    const studentHash = this.decodeStudentCode(data, width, height, transform);

    // 5. Sample Bubbles (ZipGrade-style: local background normalization + adaptive threshold)
    const results: Array<{
      questionNumber: number;
      detectedAnswer: string | null;
      correctAnswer: string;
      status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
      confidence?: number;
    }> = [];
    const normalizedKey = Array.isArray(answerKey) ? answerKey : [];
    const requestedCount = normalizedKey.length;
    const questionsToProcess = Math.max(
      1,
      Math.min(
        bubbles.length,
        requestedCount > 0 ? requestedCount : 50
      )
    );

    // Pass 1: Collect all fill data and per-question top scores for adaptive threshold
    const perQuestionData: Array<{
      fills: { option: Option; score: number }[];
      top: { option: Option; score: number };
      second: { option: Option; score: number };
    }> = [];

    for (let q = 0; q < questionsToProcess; q++) {
      const template = bubbles[q];
      const fills: { option: Option, score: number }[] = [];

      (['A', 'B', 'C', 'D'] as Option[]).forEach(opt => {
        const coord = template.options[opt];
        const imgPt = this.applyTransform(transform, coord.cx, coord.cy);

        // ZipGrade-style: Sample center only, use annulus as local background
        const innerRadius = Math.max(3, coord.radius * 0.55);
        const ringInner = Math.max(innerRadius + 2, coord.radius * 0.95);
        const ringOuter = Math.max(ringInner + 2, coord.radius * 1.45);

        const innerMean = this.getMeanBrightnessInDisk(data, width, height, imgPt, innerRadius);
        const ringMean = this.getMeanBrightnessInRing(data, width, height, imgPt, ringInner, ringOuter);

        const bg = Number.isFinite(ringMean) && ringMean > 0 ? ringMean : innerMean;
        const score = bg > 0 ? this.clamp01((bg - innerMean) / bg) : 0;
        fills.push({ option: opt, score });
      });

      const sortedFills = [...fills].sort((a, b) => b.score - a.score);
      perQuestionData.push({
        fills,
        top: sortedFills[0],
        second: sortedFills[1]
      });
    }

    // ZipGrade-style adaptive threshold: use sheet-wide statistics
    // Strong marks = 85th percentile of best fill per question.
    // Also require a minimum number of questions with clear marks to avoid blank-sheet false positives.
    const bestScores = perQuestionData.map((d) => d.top.score).filter((s) => s > 0.005);
    const sorted = bestScores.length > 0 ? [...bestScores].sort((a, b) => a - b) : [];
    const qStrong = 0.85;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(qStrong * (sorted.length - 1))));
    const strong = sorted.length > 0 ? sorted[idx] : 0.0;

    const approxMinFill = Math.max(0.12, Math.min(0.30, strong * 0.65));
    const approxMinGap = Math.max(0.04, Math.min(0.14, approxMinFill * 0.5));
    const confidentMarks = perQuestionData.filter(
      (d) => d.top.score >= approxMinFill && (d.top.score - d.second.score) >= approxMinGap
    ).length;

    console.log(
      '[OmrLite] strong:',
      strong.toFixed(3),
      'approxMinFill:',
      approxMinFill.toFixed(3),
      'approxMinGap:',
      approxMinGap.toFixed(3),
      'confidentMarks:',
      confidentMarks
    );

    // Single-pass thresholds: conservative baseline so blank sheets remain blank
    // even without a separate "blank sheet" shortcut.
    const minFill = approxMinFill;
    const minGap = approxMinGap;

    // Pass 2: Grade using adaptive thresholds
    for (let q = 0; q < questionsToProcess; q++) {
      const { fills, top, second } = perQuestionData[q];
      const correctAns = this.normalizeAnswerLetter(normalizedKey[q]);

      let status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid' = 'Blank';
      let detectedAnswer: string | null = null;

      if (top.score < minFill) {
        status = 'Blank';
      } else if ((top.score - second.score) < minGap) {
        status = 'Invalid';
      } else {
        detectedAnswer = top.option;
        if (!correctAns) {
          status = 'Invalid';
        } else {
          status = detectedAnswer === correctAns ? 'Correct' : 'Incorrect';
        }
      }

      const rawMap: { [key: string]: number } = {};
      fills.forEach(f => { rawMap[f.option] = f.score; });

      results.push({
        questionNumber: q + 1,
        detectedAnswer,
        correctAnswer: correctAns,
        status,
        confidence: top.score,
        // rawScores is only used by scan.page for debug; it's handled in OpenCvScannerService.
      });
    }

    return { gradingResults: results, studentHash };
  }

  /**
   * Decode the small 8x8 student identity grid drawn in the header.
   * Returns the lower 16-bit student hash (studentId & 0xffff) or null.
   */
  private decodeStudentCode(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    h: number[]
  ): number | null {
    // Grid definition must match answer-sheet-generator.page.html
    // Placed in the blank area between CLASS/DATE and the roll number box
    const originX = 320;
    const originY = 150;
    const cell = 6;
    const size = 8;

    const bits: number[] = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Skip outer border row/col 0 (finder)
        if (r === 0 || c === 0) continue;

        const u = originX + c * cell + cell / 2;
        const v = originY + r * cell + cell / 2;
        const pt = this.applyTransform(h, u, v);
        const brightness = this.getMeanBrightnessInDisk(data, width, height, pt, cell * 0.4);
        const bit = brightness < 150 ? 1 : 0;
        bits.push(bit);
      }
    }

    if (bits.length < 48) return null;

    const read16 = (offset: number): number => {
      let val = 0;
      for (let i = 0; i < 16; i++) {
        val = (val << 1) | (bits[offset + i] ? 1 : 0);
      }
      return val & 0xffff;
    };

    // const classPart = read16(0);
    // const subjectPart = read16(16);
    const studentPart = read16(32);
    return studentPart;
  }

  /**
   * Scans the ENTIRE image for potential markers using a fast stride.
   */
  private findAllMarkersGlobal(data: Uint8ClampedArray, width: number, height: number): Point[] {
    const markers: Point[] = [];
    const stride = 10; // Fast global scan
    
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 110) { // Potential marker dark pixel
          // Check if this point matches the nested marker pattern
          // We use a small local quadrant around this point
          const localQuad = {
            x1: Math.max(0, x - 20),
            y1: Math.max(0, y - 20),
            x2: Math.min(width, x + 20),
            y2: Math.min(height, y + 20)
          };
          const marker = this.findNestedMarker(data, width, height, localQuad);
          if (marker) {
            // Avoid duplicate markers near each other
            if (!markers.some(m => Math.hypot(m.x - marker.center.x, m.y - marker.center.y) < 50)) {
              markers.push(marker.center);
            }
          }
        }
      }
    }
    return markers;
  }

  private findBestSheetRectangle(points: Point[]): Point[] | null {
    if (points.length < 4) return null;
    
    // Simple heuristic: find the 4 points that form the largest area
    // Sort by Y to split into Top and Bottom halves
    const sortedY = [...points].sort((a, b) => a.y - b.y);
    const topPoints = sortedY.slice(0, Math.ceil(points.length / 2)).sort((a, b) => a.x - b.x);
    const bottomPoints = sortedY.slice(Math.floor(points.length / 2)).sort((a, b) => b.x - a.x);
    
    if (topPoints.length < 2 || bottomPoints.length < 2) return null;
    
    // Return TL, TR, BR, BL
    return [
      topPoints[0], 
      topPoints[topPoints.length - 1], 
      bottomPoints[0], 
      bottomPoints[bottomPoints.length - 1]
    ];
  }

  private getPaperWhite(data: Uint8ClampedArray, width: number, height: number, corners: Point[]): number {
    // Sample a small area in the center of the 4 markers
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    
    let total = 0, count = 0;
    for (let y = Math.round(cy - 20); y < cy + 20; y++) {
      for (let x = Math.round(cx - 20); x < cx + 20; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx+1] + data[idx+2]) / 3;
        count++;
      }
    }
    return count > 0 ? total / count : 200; // Fallback to safe grey-white
  }

  /**
   * Find 4 nested square markers by looking in corner quadrants.
   */
  private detectMarkers(data: Uint8ClampedArray, width: number, height: number): Marker[] {
    const markers: Marker[] = [];
    // Quadrant margins (ignore edges)
    const mX = Math.round(width * 0.05);
    const mY = Math.round(height * 0.05);
    const qW = Math.round(width * 0.35);
    const qH = Math.round(height * 0.35);

    const quadrants = [
      { x1: mX, y1: mY, x2: qW, y2: qH },                       // TL
      { x1: width - qW, y1: mY, x2: width - mX, y2: qH },       // TR
      { x1: width - qW, y1: height - qH, x2: width - mX, y2: height - mY }, // BR
      { x1: mX, y1: height - qH, x2: qW, y2: height - mY }      // BL
    ];

    for (const quad of quadrants) {
      const marker = this.findNestedMarker(data, width, height, quad);
      if (marker) markers.push(marker);
    }

    return markers;
  }

  /**
   * Specifically looks for the nested square pattern (Black-White-Black)
   */
  public findNestedMarker(data: Uint8ClampedArray, width: number, height: number, quad: any): Marker | null {
    let sumX = 0, sumY = 0, count = 0;
    const x1 = Math.max(0, Math.floor(Number(quad?.x1 ?? 0)));
    const y1 = Math.max(0, Math.floor(Number(quad?.y1 ?? 0)));
    const x2 = Math.min(width, Math.ceil(Number(quad?.x2 ?? width)));
    const y2 = Math.min(height, Math.ceil(Number(quad?.y2 ?? height)));

    let minX = x2, maxX = x1, minY = y2, maxY = y1;

    // 1. First pass: find all dark pixels in the quadrant
    // Use a slightly larger stride for real-time tracking performance
    const stride = 3; // Reduced stride for better detection at distances
    for (let y = y1; y < y2; y += stride) {
      for (let x = x1; x < x2; x += stride) {
        const idx = (Math.round(y) * width + Math.round(x)) * 4;
        // More lenient black threshold for markers (up to 120 instead of 80)
        if (data[idx] < 120 && data[idx + 1] < 120 && data[idx + 2] < 120) {
          sumX += x; sumY += y; count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }

    if (count < 6) return null; // Even more lenient count for distance

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const w = maxX - minX;
    const h = maxY - minY;

    // Basic geometry sanity checks (prevents filled bubbles from being treated as markers)
    const aspect = h > 0 ? (w / h) : 0;
    if (aspect < 0.7 || aspect > 1.35) return null;
    const size = Math.min(w, h);
    if (size < 10) return null;

    // 2. Second pass: Validate the "Nested" pattern at the center
    // Check center
    const innerIdx = (Math.round(centerY) * width + Math.round(centerX)) * 4;
    const isInnerBlack = data[innerIdx] < 130; // More lenient

    // Check ring with multiple sample points for reliability
    const offsets = [
      {dx: 0.35, dy: 0}, {dx: -0.35, dy: 0}, {dx: 0, dy: 0.35}, {dx: 0, dy: -0.35}
    ];
    
    let whitePoints = 0;
    for (const offset of offsets) {
      const rx = Math.round(centerX + w * offset.dx);
      const ry = Math.round(centerY + h * offset.dy);
      if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
        const ridx = (ry * width + rx) * 4;
        if (data[ridx] > 130) whitePoints++; // More lenient white threshold
      }
    }

    // Additionally validate outer black border further away from the center.
    // This helps reject filled bubbles (which don't have an outer black square beyond the circle).
    const outerOffsets = [
      {dx: 0.65, dy: 0}, {dx: -0.65, dy: 0}, {dx: 0, dy: 0.65}, {dx: 0, dy: -0.65}
    ];
    let outerBlackPoints = 0;
    for (const offset of outerOffsets) {
      const rx = Math.round(centerX + w * offset.dx);
      const ry = Math.round(centerY + h * offset.dy);
      if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
        const ridx = (ry * width + rx) * 4;
        const b = (data[ridx] + data[ridx + 1] + data[ridx + 2]) / 3;
        if (b < 120) outerBlackPoints++;
      }
    }

    // If at least 2 points match the "white ring" AND at least 2 match outer black, accept it.
    if (!isInnerBlack || whitePoints < 2 || outerBlackPoints < 2) return null;

    return {
      center: { x: centerX, y: centerY },
      rect: { x: minX, y: minY, w, h }
    };
  }

  /**
   * Helper to get standard quadrants for detection
   */
  public getQuadrants(width: number, height: number) {
    const mX = Math.round(width * 0.05);
    const mY = Math.round(height * 0.05);
    const qW = Math.round(width * 0.4);
    const qH = Math.round(height * 0.4);

    return [
      { id: 'tl', x1: 0, y1: 0, x2: qW, y2: qH },                       // TL
      { id: 'tr', x1: width - qW, y1: 0, x2: width, y2: qH },           // TR
      { id: 'br', x1: width - qW, y1: height - qH, x2: width, y2: height }, // BR
      { id: 'bl', x1: 0, y1: height - qH, x2: qW, y2: height }          // BL
    ];
  }

  private sortCorners(pts: Point[]): Point[] {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]]; 
  }

  /**
   * Perspective transform math (Homography).
   */
  private getPerspectiveTransform(src: Point[], dst: Point[]): number[] {
    const x0 = src[0].x, y0 = src[0].y;
    const x1 = src[1].x, y1 = src[1].y;
    const x2 = src[2].x, y2 = src[2].y;
    const x3 = src[3].x, y3 = src[3].y;

    const u0 = dst[0].x, v0 = dst[0].y;
    const u1 = dst[1].x, v1 = dst[1].y;
    const u2 = dst[2].x, v2 = dst[2].y;
    const u3 = dst[3].x, v3 = dst[3].y;

    const a = [
      [x0, y0, 1, 0, 0, 0, -u0 * x0, -u0 * y0],
      [0, 0, 0, x0, y0, 1, -v0 * x0, -v0 * y0],
      [x1, y1, 1, 0, 0, 0, -u1 * x1, -u1 * y1],
      [0, 0, 0, x1, y1, 1, -v1 * x1, -v1 * y1],
      [x2, y2, 1, 0, 0, 0, -u2 * x2, -u2 * y2],
      [0, 0, 0, x2, y2, 1, -v2 * x2, -v2 * y2],
      [x3, y3, 1, 0, 0, 0, -u3 * x3, -u3 * y3],
      [0, 0, 0, x3, y3, 1, -v3 * x3, -v3 * y3]
    ];

    const b = [u0, v0, u1, v1, u2, v2, u3, v3];
    return this.solveLinear(a, b);
  }

  private solveLinear(a: number[][], b: number[]): number[] {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let max = i;
      for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
      [a[i], a[max]] = [a[max], a[i]];
      [b[i], b[max]] = [b[max], b[i]];

      for (let j = i + 1; j < n; j++) {
        const factor = a[j][i] / a[i][i];
        b[j] -= factor * b[i];
        for (let k = i; k < n; k++) a[j][k] -= factor * a[i][k];
      }
    }

    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += a[i][j] * x[j];
      x[i] = (b[i] - sum) / a[i][i];
    }
    return x;
  }

  private applyTransform(h: number[], u: number, v: number): Point {
    const w = h[6] * u + h[7] * v + 1;
    return {
      x: (h[0] * u + h[1] * v + h[2]) / w,
      y: (h[3] * u + h[4] * v + h[5]) / w
    };
  }

  /**
   * Calculate mean brightness (0..255) inside a disk.
   */
  private getMeanBrightnessInDisk(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    pt: Point,
    radius: number
  ): number {
    let total = 0;
    let count = 0;
    const rSq = radius * radius;
    const rInt = Math.ceil(radius);

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        if (dx * dx + dy * dy > rSq) continue;

        const x = Math.round(pt.x + dx);
        const y = Math.round(pt.y + dy);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
    }

    return count > 0 ? total / count : 255;
  }

  /**
   * Calculate mean brightness (0..255) in an annulus (ring) around the bubble.
   * This is used as the local background reference, robust against shadows.
   */
  private getMeanBrightnessInRing(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    pt: Point,
    innerRadius: number,
    outerRadius: number
  ): number {
    let total = 0;
    let count = 0;
    const rInSq = innerRadius * innerRadius;
    const rOutSq = outerRadius * outerRadius;
    const rInt = Math.ceil(outerRadius);

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        const dSq = dx * dx + dy * dy;
        if (dSq < rInSq || dSq > rOutSq) continue;

        const x = Math.round(pt.x + dx);
        const y = Math.round(pt.y + dy);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
    }

    return count > 0 ? total / count : NaN;
  }

  private normalizeAnswerLetter(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }
}
