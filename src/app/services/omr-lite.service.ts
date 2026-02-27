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
  processFrame(canvas: HTMLCanvasElement, answerKey: string[]): any {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get canvas context');

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. GLOBAL SEARCH for markers (Find markers ANYWHERE in the image)
    const allMarkers = this.findAllMarkersGlobal(data, width, height);
    
    // 2. Filter and find the best 4 markers forming a sheet rectangle
    let markersToUse: Point[] = [];
    const bestRect = this.findBestSheetRectangle(allMarkers);
    
    if (bestRect && bestRect.length === 4) {
      markersToUse = bestRect;
    } else {
      // Fallback: Try the legacy quadrant detection if global search fails
      const legacyMarkers = this.detectMarkers(data, width, height);
      if (legacyMarkers.length === 4) {
        markersToUse = legacyMarkers.map(m => m.center);
      } else {
        throw new Error(`Sheet not fully visible. Ensure all 4 corner markers are in the photo.`);
      }
    }

    // 3. Compute Perspective Transform
    const sortedMarkers = this.sortCorners(markersToUse);
    const transform = this.getPerspectiveTransform(this.TEMPLATE_MARKERS, sortedMarkers);

    // 4. Sample Paper White (LOCAL COMPENSATION)
    // We sample white space near the middle of the sheet to get a baseline for lighting
    const paperWhite = this.getPaperWhite(data, width, height, sortedMarkers);

    // 5. Sample Bubbles
    const results = [];
    const questionsToProcess = 50; 
    
    for (let q = 0; q < questionsToProcess; q++) {
      const template = bubbles[q];
      const fills: { option: Option, percent: number }[] = [];

      // ACCURACY BOOST: Sample local white level for each column to handle shadows
      const colX = q < 25 ? sortedMarkers[0].x + (sortedMarkers[1].x - sortedMarkers[0].x) * 0.25 : sortedMarkers[0].x + (sortedMarkers[1].x - sortedMarkers[0].x) * 0.75;
      const localWhite = this.getPaperWhite(data, width, height, sortedMarkers); // Use global for now, but localized

      (['A', 'B', 'C', 'D'] as Option[]).forEach(opt => {
        const coord = template.options[opt];
        const imgPt = this.applyTransform(transform, coord.cx, coord.cy);
        
        // ACCURACY BOOST: Use a smaller radius (radius - 4) to stay strictly INSIDE the circle border.
        // This prevents the black border of an empty circle from being counted as shading.
        const sampleRadius = coord.radius - 4;
        const fillPercent = this.getFillPercentage(data, width, height, imgPt, sampleRadius, paperWhite);
        fills.push({ option: opt, percent: fillPercent });
      });

      // Grade
      const sortedFills = [...fills].sort((a, b) => b.percent - a.percent);
      const top = sortedFills[0];
      const second = sortedFills[1];

      let status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid' = 'Blank';
      let detectedAnswer: string | null = null;

      /**
       * PENCIL OPTIMIZATION (No-Letters + Border-Ignore Edition):
       * Since we are only sampling the INSIDE of the circle, a blank bubble will be ~0%.
       * A shaded bubble will be very high (>40%).
       */
      const DEFINITE_THRESHOLD = 0.40; // Any bubble more than 40% full is definitely an answer
      const MIN_THRESHOLD = 0.20; // Lower than this is noise or paper texture

      if (top.percent < MIN_THRESHOLD) {
        status = 'Blank';
      } else if (top.percent >= DEFINITE_THRESHOLD) {
        // Very strong mark, check if it's unique
        if (second.percent > DEFINITE_THRESHOLD || (top.percent - second.percent < 0.20)) {
          status = 'Invalid'; // Double marked
        } else {
          detectedAnswer = top.option;
          // Use answerKey[q] or fallback to 'A' if not provided
          const correctAns = answerKey[q] || 'A';
          status = detectedAnswer === correctAns ? 'Correct' : 'Incorrect';
        }
      } else {
        // Potential pencil mark (20% - 60%)
        // Must be significantly darker than the second best option to be valid
        if (top.percent - second.percent > 0.15) {
          detectedAnswer = top.option;
          const correctAns = answerKey[q] || 'A';
          status = detectedAnswer === correctAns ? 'Correct' : 'Incorrect';
        } else {
          status = 'Invalid'; // Too close to call / ambiguous
        }
      }

      results.push({
        questionNumber: q + 1,
        detectedAnswer,
        correctAnswer: answerKey[q] || 'A',
        status,
        confidence: top.percent
      });
    }

    return results;
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
          const localQuad = { x1: x-20, y1: y-20, x2: x+20, y2: y+20 };
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
    let minX = quad.x2, maxX = quad.x1, minY = quad.y2, maxY = quad.y1;

    // 1. First pass: find all dark pixels in the quadrant
    // Use a slightly larger stride for real-time tracking performance
    const stride = 3; // Reduced stride for better detection at distances
    for (let y = quad.y1; y < quad.y2; y += stride) {
      for (let x = quad.x1; x < quad.x2; x += stride) {
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

    // If at least 2 points match the "white ring" pattern, we accept it
    if (!isInnerBlack || whitePoints < 2) return null;

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
   * Calculate fill darkness relative to the paper white level.
   */
  private getFillPercentage(data: Uint8ClampedArray, width: number, height: number, pt: Point, radius: number, paperWhite: number): number {
    let darkCount = 0, totalCount = 0;
    const rSq = radius * radius;
    const rInt = Math.ceil(radius);

    // Adaptive threshold: a pixel is "filled" if it's significantly darker than the paper white
    const darkThreshold = paperWhite * 0.80; // 20% darker than paper (optimized for pencil)

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        if (dx * dx + dy * dy > rSq) continue;
        
        const x = Math.round(pt.x + dx);
        const y = Math.round(pt.y + dy);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        if (brightness < darkThreshold) darkCount++;
        totalCount++;
      }
    }
    return totalCount === 0 ? 0 : darkCount / totalCount;
  }
}
