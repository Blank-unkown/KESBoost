/**
 * OMR Web Worker for offloading heavy image processing
 * This runs in a separate thread to prevent UI blocking on mobile devices
 * 
 * Usage:
 *   const worker = new Worker('./omr-worker.ts', { type: 'module' });
 *   worker.postMessage({ type: 'detectCorners', imageData: ... });
 *   worker.onmessage = (e) => { ... };
 */

// Type definitions for worker messages
type WorkerMessageType = 'init' | 'detectCorners' | 'processBubbles' | 'warpPerspective' | 'cleanup';

interface WorkerMessage {
  type: WorkerMessageType;
  id: string;
  payload: any;
}

interface CornerDetectionResult {
  corners: { x: number; y: number }[] | null;
  scores: number[];
  success: boolean;
  error?: string;
}

interface BubbleProcessResult {
  answers: Array<{
    question: number;
    ratios: { A: number; B: number; C: number; D: number };
    selected: string | null;
    multipleMarks: boolean;
  }>;
  success: boolean;
  error?: string;
}

// OpenCV reference (will be loaded via importScripts or global)
declare var cv: any;

// Track OpenCV initialization state
let cvReady = false;
let cvInitializing = false;

/**
 * Initialize OpenCV.js in the worker context
 */
async function initOpenCV(): Promise<boolean> {
  if (cvReady) return true;
  if (cvInitializing) {
    // Wait for existing initialization
    while (cvInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return cvReady;
  }

  cvInitializing = true;
  
  try {
    // For web workers, we need to load OpenCV differently
    // The main thread should have already loaded it, but we import it here
    if (typeof (self as any).cv !== 'undefined' && (self as any).cv.Mat) {
      cv = (self as any).cv;
      cvReady = true;
      return true;
    }

    // If cv is not available, wait for it to be injected
    // This typically happens when the main thread shares the cv object
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (typeof (self as any).cv !== 'undefined' && (self as any).cv.Mat) {
        cv = (self as any).cv;
        cvReady = true;
        return true;
      }
    }

    throw new Error('OpenCV not available in worker context');
  } catch (e) {
    console.error('[OMR Worker] Failed to initialize OpenCV:', e);
    return false;
  } finally {
    cvInitializing = false;
  }
}

/**
 * Detect corner markers using OpenCV contour filtering
 * This is the same algorithm as in scan.page.ts but runs in worker thread
 */
function detectCornerMarkers(
  imageData: ImageData,
  config: {
    minAreaRatio: number;
    maxAreaRatio: number;
    minSolidity: number;
    aspectMin: number;
    aspectMax: number;
    regionFrac: number;
  }
): CornerDetectionResult {
  if (!cvReady) {
    return { corners: null, scores: [], success: false, error: 'OpenCV not ready' };
  }

  const { width, height, data } = imageData;
  const W = width;
  const H = height;

  if (W < 100 || H < 100) {
    return { corners: null, scores: [], success: false, error: 'Image too small' };
  }

  // Create OpenCV Mat from ImageData
  const src = new cv.Mat(H, W, cv.CV_8UC4);
  src.data.set(new Uint8Array(data.buffer));

  // Convert to grayscale
  const gray = new cv.Mat();
  if (src.channels() === 4) {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  } else {
    src.copyTo(gray);
  }

  // Apply adaptive thresholding
  const bin = new cv.Mat();
  cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 15);

  // Morphological closing to connect nearby regions
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Define corner regions
  const cornerRegions = [
    { name: 'tl', x0: 0, y0: 0, x1: Math.floor(W * config.regionFrac), y1: Math.floor(H * config.regionFrac) },
    { name: 'tr', x0: W - Math.floor(W * config.regionFrac), y0: 0, x1: W, y1: Math.floor(H * config.regionFrac) },
    { name: 'bl', x0: 0, y0: H - Math.floor(H * config.regionFrac), x1: Math.floor(W * config.regionFrac), y1: H },
    { name: 'br', x0: W - Math.floor(W * config.regionFrac), y0: H - Math.floor(H * config.regionFrac), x1: W, y1: H }
  ];

  const detectedCorners: Map<string, { x: number; y: number; score: number }> = new Map();
  const minMarkerArea = (W * H) * config.minAreaRatio;
  const maxMarkerArea = (W * H) * config.maxAreaRatio;

  // Analyze each contour
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    if (area < minMarkerArea || area > maxMarkerArea) {
      cnt.delete();
      continue;
    }

    const rect = cv.boundingRect(cnt);
    const aspectRatio = rect.width / Math.max(1, rect.height);

    if (aspectRatio < config.aspectMin || aspectRatio > config.aspectMax) {
      cnt.delete();
      continue;
    }

    // Compute solidity
    const hull = new cv.Mat();
    cv.convexHull(cnt, hull, false, false);
    const hullArea = cv.contourArea(hull);
    const solidity = hullArea > 0 ? area / hullArea : 0;
    hull.delete();

    if (solidity < config.minSolidity) {
      cnt.delete();
      continue;
    }

    // Get centroid
    const M = cv.moments(cnt);
    if (M.m00 === 0) {
      cnt.delete();
      continue;
    }
    const cx = M.m10 / M.m00;
    const cy = M.m01 / M.m00;

    // Check which corner region this belongs to
    for (const region of cornerRegions) {
      if (cx >= region.x0 && cx < region.x1 && cy >= region.y0 && cy < region.y1) {
        const score = solidity * (1 - Math.abs(1 - aspectRatio));
        const existing = detectedCorners.get(region.name);
        if (!existing || score > existing.score) {
          detectedCorners.set(region.name, { x: cx, y: cy, score });
        }
        break;
      }
    }

    cnt.delete();
  }

  // Cleanup
  src.delete(); gray.delete(); bin.delete(); kernel.delete();
  contours.delete(); hierarchy.delete();

  // Check if all 4 corners were found
  if (detectedCorners.size !== 4) {
    return { corners: null, scores: [], success: false, error: `Found ${detectedCorners.size}/4 corners` };
  }

  const tl = detectedCorners.get('tl');
  const tr = detectedCorners.get('tr');
  const bl = detectedCorners.get('bl');
  const br = detectedCorners.get('br');

  if (!tl || !tr || !bl || !br) {
    return { corners: null, scores: [], success: false, error: 'Missing corner data' };
  }

  const corners = [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y }
  ];

  const scores = [tl.score, tr.score, br.score, bl.score];

  return { corners, scores, success: true };
}

/**
 * Process bubbles to detect filled answers
 */
function processBubbles(
  imageData: ImageData,
  bubbleCoords: Array<{
    question: number;
    options: {
      A: { cx: number; cy: number; radius: number };
      B: { cx: number; cy: number; radius: number };
      C: { cx: number; cy: number; radius: number };
      D: { cx: number; cy: number; radius: number };
    };
  }>,
  config: {
    fillThreshold: number;
    templateOffsetX: number;
    templateOffsetY: number;
  }
): BubbleProcessResult {
  if (!cvReady) {
    return { answers: [], success: false, error: 'OpenCV not ready' };
  }

  const { width, height, data } = imageData;
  const W = width;
  const H = height;

  // Create OpenCV Mat
  const src = new cv.Mat(H, W, cv.CV_8UC4);
  src.data.set(new Uint8Array(data.buffer));

  // Convert to grayscale
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const answers: BubbleProcessResult['answers'] = [];

  for (const bubble of bubbleCoords) {
    const qNum = bubble.question;
    const ratios: { A: number; B: number; C: number; D: number } = { A: 0, B: 0, C: 0, D: 0 };

    for (const opt of ['A', 'B', 'C', 'D'] as const) {
      const { cx, cy, radius } = bubble.options[opt];
      const x = cx + config.templateOffsetX;
      const y = cy + config.templateOffsetY;

      // Extract patch around bubble
      const side = Math.max(2 * radius, 1);
      const patchX = Math.max(0, Math.min(W - 1, Math.round(x - radius)));
      const patchY = Math.max(0, Math.min(H - 1, Math.round(y - radius)));
      const patchW = Math.min(side, W - patchX);
      const patchH = Math.min(side, H - patchY);

      const patch = gray.roi(new cv.Rect(patchX, patchY, patchW, patchH));

      // Threshold
      const bin = new cv.Mat();
      cv.threshold(patch, bin, 125, 255, cv.THRESH_BINARY_INV);

      // Create circular mask
      const mask = cv.Mat.zeros(patchH, patchW, cv.CV_8UC1);
      const rx = Math.min(patchW, patchH) / 2 - 1;
      cv.circle(
        mask,
        new cv.Point(Math.round(patchW / 2), Math.round(patchH / 2)),
        Math.round(rx),
        new cv.Scalar(255),
        -1
      );

      // Apply mask
      const masked = new cv.Mat();
      cv.bitwise_and(bin, mask, masked);
      cv.morphologyEx(masked, masked, cv.MORPH_OPEN, kernel);

      // Count filled pixels
      const nonZero = cv.countNonZero(masked);
      const totalPixels = Math.PI * rx * rx;
      ratios[opt] = nonZero / totalPixels;

      patch.delete(); bin.delete(); mask.delete(); masked.delete();
    }

    // Determine selected answer
    const markedOptions: string[] = [];
    for (const opt of ['A', 'B', 'C', 'D'] as const) {
      if (ratios[opt] > config.fillThreshold) {
        markedOptions.push(opt);
      }
    }

    let selected: string | null = null;
    let multipleMarks = false;

    if (markedOptions.length === 1) {
      selected = markedOptions[0];
    } else if (markedOptions.length > 1) {
      multipleMarks = true;
      let maxRatio = 0;
      for (const opt of markedOptions) {
        if (ratios[opt as 'A' | 'B' | 'C' | 'D'] > maxRatio) {
          maxRatio = ratios[opt as 'A' | 'B' | 'C' | 'D'];
          selected = opt;
        }
      }
    }

    answers.push({ question: qNum, ratios, selected, multipleMarks });
  }

  src.delete(); gray.delete(); kernel.delete();

  return { answers, success: true };
}

/**
 * Apply perspective warp to normalize the sheet
 */
function warpPerspective(
  imageData: ImageData,
  corners: { x: number; y: number }[],
  targetSize: { width: number; height: number }
): { imageData: ImageData; success: boolean; error?: string } {
  if (!cvReady) {
    return { imageData: imageData, success: false, error: 'OpenCV not ready' };
  }

  if (corners.length !== 4) {
    return { imageData: imageData, success: false, error: 'Need exactly 4 corners' };
  }

  const { width, height, data } = imageData;
  const W = width;
  const H = height;

  // Order corners: tl, tr, br, bl
  const sum = corners.map(p => ({ p, s: p.x + p.y }));
  const diff = corners.map(p => ({ p, d: p.x - p.y }));
  const tl = sum.reduce((a, b) => (a.s < b.s ? a : b)).p;
  const br = sum.reduce((a, b) => (a.s > b.s ? a : b)).p;
  const tr = diff.reduce((a, b) => (a.d > b.d ? a : b)).p;
  const bl = diff.reduce((a, b) => (a.d < b.d ? a : b)).p;
  const ordered = [tl, tr, br, bl];

  // Create source Mat
  const src = new cv.Mat(H, W, cv.CV_8UC4);
  src.data.set(new Uint8Array(data.buffer));

  // Compute perspective transform
  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ordered[0].x, ordered[0].y,
    ordered[1].x, ordered[1].y,
    ordered[2].x, ordered[2].y,
    ordered[3].x, ordered[3].y
  ]);

  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, targetSize.width, 0,
    targetSize.width, targetSize.height, 0, targetSize.height
  ]);

  const M = cv.getPerspectiveTransform(srcPoints, dstPoints);

  // Warp
  const dst = new cv.Mat();
  const dsize = new cv.Size(targetSize.width, targetSize.height);
  cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  // Convert back to ImageData
  const resultData = new Uint8ClampedArray(dst.data);
  const resultImageData: ImageData = {
    width: targetSize.width,
    height: targetSize.height,
    data: resultData,
    colorSpace: 'srgb'
  } as ImageData;

  // Cleanup
  src.delete(); dst.delete();
  srcPoints.delete(); dstPoints.delete(); M.delete();

  return { imageData: resultImageData, success: true };
}

/**
 * Cleanup OpenCV resources
 */
function cleanup() {
  // In Web Workers, we typically don't need to explicitly cleanup
  // as the worker will be terminated
  cvReady = false;
}

// Message handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = e.data;

  try {
    switch (type) {
      case 'init':
        const initSuccess = await initOpenCV();
        self.postMessage({ id, type: 'init', success: initSuccess });
        break;

      case 'detectCorners':
        const cornerResult = detectCornerMarkers(payload.imageData, payload.config);
        self.postMessage({ id, type: 'detectCorners', ...cornerResult });
        break;

      case 'processBubbles':
        const bubbleResult = processBubbles(payload.imageData, payload.bubbleCoords, payload.config);
        self.postMessage({ id, type: 'processBubbles', ...bubbleResult });
        break;

      case 'warpPerspective':
        const warpResult = warpPerspective(payload.imageData, payload.corners, payload.targetSize);
        self.postMessage({ id, type: 'warpPerspective', ...warpResult });
        break;

      case 'cleanup':
        cleanup();
        self.postMessage({ id, type: 'cleanup', success: true });
        break;

      default:
        self.postMessage({ id, type, success: false, error: 'Unknown message type' });
    }
  } catch (err: any) {
    self.postMessage({ id, type, success: false, error: err?.message || String(err) });
  }
};

// Export for module type
export { detectCornerMarkers, processBubbles, warpPerspective, initOpenCV };
