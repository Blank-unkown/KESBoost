/**
 * Full OpenCV-based OMR Scanner (ZipGrade-style)
 *
 * Pipeline:
 * 1. Load OpenCV.js (from CDN script in index.html)
 * 2. Corner detection via contours (adaptive threshold, findContours)
 * 3. Perspective warp to fixed sheet size
 * 4. Template-based bubble sampling with annulus fill scoring
 * 5. Adaptive threshold (sheet-wide statistics)
 */

import { Injectable } from '@angular/core';
import { bubbles, Option } from '../data/bubble-template';

export interface GradingResult {
  questionNumber: number;
  detectedAnswer: string | null;
  correctAnswer: string;
  status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
  confidence?: number;
  rawScores?: { [key: string]: number };
}

export interface OpenCvScanResult {
  gradingResults: GradingResult[];
  studentHash: number | null;
}

@Injectable({ providedIn: 'root' })
export class OpenCvScannerService {
  private cvInstance: any = null;
  private initPromise: Promise<any> | null = null;
  private runtimeReadyPromise: Promise<any> | null = null;

  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131;

  // Corner markers in template coordinates (centers of the 55x55 nested squares)
  // Matches answer-sheet-generator.page.html marker positions.
  readonly TEMPLATE_MARKERS = {
    tl: { x: 42.5, y: 42.5 },
    tr: { x: 757.5, y: 42.5 },
    br: { x: 757.5, y: 1088.5 },
    bl: { x: 42.5, y: 1088.5 }
  };

  /** Call early (e.g. on scan page init) to preload OpenCV from CDN */
  preload(): void {
    void this.ensureOpenCv().catch(() => {});
  }

  async ensureOpenCv(): Promise<any> {
    // Check cached instance first
    if (this.cvInstance) return this.cvInstance;

    // Check if OpenCV is already ready right now (synchronous check)
    const cvNow = (window as any).cv;
    if (cvNow?.Mat) {
      this.cvInstance = cvNow;
      console.log('[OpenCV] ✅ Already initialized (cv.Mat exists)');
      return cvNow;
    }

    // Check if we're already initializing
    if (this.initPromise) return this.initPromise;

    console.log('[OpenCV] Starting initialization wait...');
    this.initPromise = (async () => {
      // Double-check after async start
      const cvCheck = (window as any).cv;
      if (cvCheck?.Mat) {
        this.cvInstance = cvCheck;
        console.log('[OpenCV] ✅ Initialized during async check');
        return cvCheck;
      }

      // Wait for script tag to populate window.cv
      for (let i = 0; i < 400; i++) { // 400 * 50ms = 20s max wait
        const cv = (window as any).cv;
        if (cv?.Mat) {
          this.cvInstance = cv;
          console.log('[OpenCV] ✅ Initialized after', i * 50, 'ms');
          return cv;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      this.initPromise = null;
      throw new Error('OpenCV did not load. Ensure opencv.js script is loaded (index.html).');
    })();

    return this.initPromise;
  }

  async processFrame(canvas: HTMLCanvasElement, answerKey: string[]): Promise<OpenCvScanResult> {
    console.log('[OpenCV] processFrame started. Canvas:', canvas?.width, 'x', canvas?.height);
    
    // Check canvas validity
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      console.error('[OpenCV] Invalid canvas dimensions');
      throw new Error('Invalid canvas dimensions for processing');
    }

    console.log('[OpenCV] Getting direct reference to window.cv');
    const cv = (window as any).cv;
    if (!cv || !cv.Mat) {
      console.error('[OpenCV] OpenCV global not ready in processFrame');
      throw new Error('OpenCV instance not available');
    }

    console.log('[OpenCV] Attempting to get 2D context...');
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false // Faster readback if we don't need transparency
    });
    
    if (!ctx) {
      console.error('[OpenCV] Could not get 2D context from canvas');
      throw new Error('Could not get canvas context');
    }

    console.log('[OpenCV] Context obtained. Calling getImageData...');
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      console.log('[OpenCV] getImageData successful. Size:', imageData.data.length);
    } catch (e: any) {
      console.error('[OpenCV] getImageData failed:', e);
      throw new Error('Failed to extract image data: ' + (e.message || 'Unknown error'));
    }

    console.log('[OpenCV] Calling imageDataToMat...');
    const src = this.imageDataToMat(cv, imageData);
    console.log('[OpenCV] Mat created successfully');

    try {
      console.log('[OpenCV] Starting detectCorners...');
      const corners = this.detectCorners(cv, src);
      if (!corners || corners.length !== 4) {
        console.warn('[OpenCV] Corner detection failed');
        throw new Error('Could not detect all 4 corner markers. Align the sheet within the frame.');
      }

      console.log('[OpenCV] Corners found. Warping...');
      const warped = this.warpPerspective(cv, src, corners);
      
      console.log('[OpenCV] Decoding student code...');
      const studentHash = this.decodeStudentCode(cv, warped);
      
      console.log('[OpenCV] Grading bubbles...');
      const gradingResults = this.gradeBubbles(cv, warped, answerKey);

      console.log('[OpenCV] All processing steps finished');
      return { gradingResults, studentHash };
    } catch (e: any) {
      console.error('[OpenCV] Processing pipeline error:', e);
      throw e;
    } finally {
      if (src && !src.isDeleted()) {
        src.delete();
        console.log('[OpenCV] Cleanup: src Mat deleted');
      }
    }
  }

  private imageDataToMat(cv: any, imageData: ImageData): any {
    console.log('[OpenCV] imageDataToMat dimensions:', imageData.width, 'x', imageData.height);
    
    // Fallback: manual copy to avoid any potential cv.matFromImageData issues
    const mat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
    mat.data.set(imageData.data);
    console.log('[OpenCV] imageDataToMat: manual copy successful');
    return mat;
  }

  // Detect the 4 corner nested-square markers (TL/TR/BR/BL)
  private detectCorners(cv: any, src: any): Array<{ x: number; y: number }> | null {
    console.log('[OpenCV] detectCorners: Creating Mats');
    const gray = new cv.Mat();
    const bin = new cv.Mat();
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();
    
    try {
      console.log('[OpenCV] detectCorners: cvtColor');
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      
      console.log('[OpenCV] detectCorners: GaussianBlur');
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

      console.log('[OpenCV] detectCorners: adaptiveThreshold');
      cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 10);

      console.log('[OpenCV] detectCorners: findContours');
      cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const contoursSize = contours.size();
      console.log('[OpenCV] detectCorners: found', contoursSize, 'contours');

      const w = src.cols;
      const h = src.rows;
      const imgArea = w * h;

      const minArea = imgArea * 0.0005;
      const maxArea = imgArea * 0.05;

      const detected: { [k: string]: { x: number; y: number; score: number } | null } = {
        tl: null, tr: null, br: null, bl: null
      };

      const regionFrac = 0.4;
      const regions = {
        tl: { x0: 0, y0: 0, x1: Math.floor(w * regionFrac), y1: Math.floor(h * regionFrac) },
        tr: { x0: w - Math.floor(w * regionFrac), y0: 0, x1: w, y1: Math.floor(h * regionFrac) },
        bl: { x0: 0, y0: h - Math.floor(h * regionFrac), x1: Math.floor(w * regionFrac), y1: h },
        br: { x0: w - Math.floor(w * regionFrac), y0: h - Math.floor(h * regionFrac), x1: w, y1: h }
      };

      console.log('[OpenCV] detectCorners: looping through contours');
      const maxToProcess = Math.min(contoursSize, 1000);
      for (let i = 0; i < maxToProcess; i++) {
        let cnt: any;
        try {
          cnt = contours.get(i);
          if (!cnt) continue;
          
          const area = cv.contourArea(cnt);
          if (area < minArea || area > maxArea) {
            cnt.delete();
            continue;
          }

          const rect = cv.boundingRect(cnt);
          const ar = rect.width / Math.max(1, rect.height);
          if (ar < 0.7 || ar > 1.35) {
            cnt.delete();
            continue;
          }

          const m = cv.moments(cnt);
          if (!m.m00) {
            cnt.delete();
            continue;
          }
          const cx = m.m10 / m.m00;
          const cy = m.m01 / m.m00;

          const score = 1 - Math.abs(1 - ar);

          const inRegion = (r: any) => cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1;
          (['tl', 'tr', 'br', 'bl'] as const).forEach((k) => {
            if (!inRegion((regions as any)[k])) return;
            const cur = detected[k];
            if (!cur || score > cur.score) detected[k] = { x: cx, y: cy, score };
          });

          cnt.delete();
        } catch (innerE) {
          console.error('[OpenCV] Contour processing error at index', i, innerE);
          if (cnt) try { cnt.delete(); } catch {}
        }
      }
      console.log('[OpenCV] detectCorners: loop finished');

      const results = ['tl', 'tr', 'br', 'bl'].map(k => detected[k]);
      if (results.every(r => r !== null)) {
        console.log('[OpenCV] detectCorners: ✅ Found all corners');
        return results as Array<{ x: number; y: number }>;
      }
      console.warn('[OpenCV] detectCorners: ❌ Missing corners:', results.map((r, i) => r ? 'OK' : ['TL','TR','BR','BL'][i]));
      return null;
    } catch (e) {
      console.error('[OpenCV] detectCorners error:', e);
      return null;
    } finally {
      try { gray.delete(); } catch {}
      try { bin.delete(); } catch {}
      try { hierarchy.delete(); } catch {}
      try { contours.delete(); } catch {}
    }
  }

  private warpPerspective(cv: any, src: any, corners: Array<{ x: number; y: number }>): any {
    // corners are already ordered tl,tr,br,bl from detectCorners
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);

    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      this.TEMPLATE_MARKERS.tl.x, this.TEMPLATE_MARKERS.tl.y,
      this.TEMPLATE_MARKERS.tr.x, this.TEMPLATE_MARKERS.tr.y,
      this.TEMPLATE_MARKERS.br.x, this.TEMPLATE_MARKERS.br.y,
      this.TEMPLATE_MARKERS.bl.x, this.TEMPLATE_MARKERS.bl.y
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const dst = new cv.Mat();
    const dsize = new cv.Size(this.SHEET_WIDTH, this.SHEET_HEIGHT);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return dst;
  }

  private decodeStudentCode(cv: any, warped: any): number | null {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

    const originX = 320;
    const originY = 150;
    const cell = 6;
    const size = 8;
    const bits: number[] = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (r === 0 || c === 0) continue;
        const px = Math.round(originX + c * cell + cell / 2);
        const py = Math.round(originY + r * cell + cell / 2);
        if (px >= 0 && px < gray.cols && py >= 0 && py < gray.rows) {
          const val = gray.ucharAt(py, px);
          bits.push(val < 150 ? 1 : 0);
        }
      }
    }

    gray.delete();

    if (bits.length < 48) return null;

    const read16 = (offset: number): number => {
      let val = 0;
      for (let i = 0; i < 16; i++) {
        val = (val << 1) | (bits[offset + i] ? 1 : 0);
      }
      return val & 0xffff;
    };

    return read16(32);
  }

  private gradeBubbles(cv: any, warped: any, answerKey: string[]): GradingResult[] {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

    const normalizedKey = Array.isArray(answerKey) ? answerKey : [];
    // Ensure we process all questions in the key, up to template limit
    const n = Math.max(1, Math.min(bubbles.length, normalizedKey.length || 50));
    console.log('[OpenCV] Grading questions 1 to', n);

    const perQuestion: Array<{ fills: { opt: Option; score: number }[]; top: { opt: Option; score: number }; second: { opt: Option; score: number } }> = [];

    for (let q = 0; q < n; q++) {
      const t = bubbles[q];
      const fills: { opt: Option; score: number }[] = [];

      for (const opt of ['A', 'B', 'C', 'D'] as Option[]) {
        const coord = t.options[opt];
        const score = this.bubbleFillScore(cv, gray, coord.cx, coord.cy, coord.radius);
        fills.push({ opt, score });
      }

      const sorted = [...fills].sort((a, b) => b.score - a.score);
      perQuestion.push({
        fills,
        top: sorted[0],
        second: sorted[1]
      });
    }

    // --- Adaptive thresholds (ZipGrade-style, aligned with OmrLiteService) ---
    const bestScores = perQuestion.map((d) => d.top.score).filter((s) => s > 0.005);
    const sorted = bestScores.length > 0 ? [...bestScores].sort((a, b) => a - b) : [];

    // Use ~85th percentile of best-per-question scores as "strong" mark level.
    const qStrong = 0.85;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(qStrong * (sorted.length - 1))));
    const strong = sorted.length > 0 ? sorted[idx] : 0.0;

    console.log('[OpenCV] strong score:', strong.toFixed(3));

    // Approximate thresholds; we now use these directly as grading thresholds
    // instead of having a separate "blank sheet" shortcut. Truly blank sheets
    // naturally produce low scores that fall below minFill, so every question
    // becomes Blank without forcing an early return.
    const minFill = Math.max(0.12, Math.min(0.30, strong * 0.65));
    const minGap = Math.max(0.04, Math.min(0.14, minFill * 0.5));

    console.log(
      '[OpenCV] Final thresholds - minFill:',
      minFill.toFixed(3),
      'minGap:',
      minGap.toFixed(3)
    );

    const results: GradingResult[] = [];
    for (let q = 0; q < n; q++) {
      const { fills, top, second } = perQuestion[q];
      const correctAns = this.normalizeKey(normalizedKey[q]);

      let status: GradingResult['status'] = 'Blank';
      let detectedAnswer: string | null = null;

      if (top.score < minFill) {
        status = 'Blank';
      } else if (top.score - second.score < minGap) {
        status = 'Invalid';
      } else {
        detectedAnswer = top.opt;
        status = !correctAns ? 'Invalid' : (detectedAnswer === correctAns ? 'Correct' : 'Incorrect');
      }

      results.push({
        questionNumber: q + 1,
        detectedAnswer,
        correctAnswer: correctAns,
        status,
        confidence: top.score,
        rawScores: this.getRawScores(fills)
      });
    }

    gray.delete();
    return results;
  }

  private getRawScores(fills: { opt: Option; score: number }[]): { [key: string]: number } {
    const scores: { [key: string]: number } = {};
    fills.forEach(f => { scores[f.opt] = f.score; });
    return scores;
  }

  private bubbleFillScore(cv: any, gray: any, cx: number, cy: number, radius: number): number {
    const r = Math.max(8, radius);

    // Heavier focus on the very center of the bubble so filled circles
    // separate more clearly from unfilled ones, especially on printed sheets.
    const innerRadius = Math.round(r * 0.9);
    const innerMean = this.meanInCircle(cv, gray, cx, cy, innerRadius);

    // Local background: thin ring just outside the bubble outline.
    const bgInner = Math.round(r * 1.05);
    const bgOuter = Math.round(r * 1.35);
    const bgMean = this.meanInAnnulus(cv, gray, cx, cy, bgInner, bgOuter);

    const delta = bgMean - innerMean;
    // Normalize against full 0–255 range instead of bgMean to reduce
    // sensitivity to global exposure and make dark fills stand out more.
    return Math.max(0, Math.min(1, delta / 255));
  }

  private meanInCircle(cv: any, gray: any, cx: number, cy: number, radius: number): number {
    const w = gray.cols;
    const h = gray.rows;
    const rInt = Math.ceil(radius);
    let total = 0;
    let count = 0;
    const rSq = radius * radius;

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        if (dx * dx + dy * dy > rSq) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < w && y >= 0 && y < h) {
          total += gray.ucharAt(y, x);
          count++;
        }
      }
    }
    return count > 0 ? total / count : 255;
  }

  private meanInAnnulus(cv: any, gray: any, cx: number, cy: number, rIn: number, rOut: number): number {
    const w = gray.cols;
    const h = gray.rows;
    const rInt = Math.ceil(rOut);
    let total = 0;
    let count = 0;
    const rInSq = rIn * rIn;
    const rOutSq = rOut * rOut;

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        const dSq = dx * dx + dy * dy;
        if (dSq < rInSq || dSq > rOutSq) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < w && y >= 0 && y < h) {
          total += gray.ucharAt(y, x);
          count++;
        }
      }
    }
    return count > 0 ? total / count : 255;
  }

  private normalizeKey(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return ['A', 'B', 'C', 'D'].includes(s) ? s : '';
  }
}
