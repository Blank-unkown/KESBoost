import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { NgZone } from '@angular/core';
import { BubbleTemplate, bubbles, Option, BubbleCoordinate } from '../../data/bubble-template';
import { Platform } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { NavController } from '@ionic/angular';
import { Chart } from 'chart.js';
import { LocalDataService, ScannedResult } from '../../services/local-data.service';
import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
import { FormsModule } from '@angular/forms';
import { CameraService } from '../../services/camera.service';
import { PreloaderService } from '../../services/preloader.service';
import jsQR from 'jsqr';

declare var cv: any;
declare const Tesseract: any;

interface Question {
  questionNumber: number;
  answer: 'A' | 'B' | 'C' | 'D';
}
interface AnswerSheet {
  id: number;
  teacher_id: number;
  exam_title: string;
  subject: string;
  grade_level: string;
  questions: Question[];
}
export interface Result {
  question: number;
  marked: Option | null;
  correctAnswer: Option | null;
  correct: boolean;
  topic?: string | null;       // ✅ added
  competency?: string | null;  // ✅ added
  level?: string | null;       // ✅ added
}

export interface AnswerEntry {
  question: number;
  marked: Option | null;
  correctAnswer: Option | null;
  correct: boolean;
  topic?: string | null;
  competency?: string | null;
  level?: string | null;
}


function isOption(value: string | null): value is Option {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}
function isGoodWarpCandidate(corners: { x: number, y: number }[]): boolean {
  const dx = (p1: { x: number, y: number }, p2: { x: number, y: number }) => p2.x - p1.x;
  const dy = (p1: { x: number, y: number }, p2: { x: number, y: number }) => p2.y - p1.y;
  const dist = (p1: { x: number, y: number }, p2: { x: number, y: number }) =>
    Math.hypot(dx(p1, p2), dy(p1, p2));

  const angle = (
    a: { x: number, y: number },
    b: { x: number, y: number },
    c: { x: number, y: number }
  ) => {
    const ab: [number, number] = [dx(a, b), dy(a, b)];
    const cb: [number, number] = [dx(c, b), dy(c, b)];
    const dot = ab[0] * cb[0] + ab[1] * cb[1];
    const mag1 = Math.hypot(...ab);
    const mag2 = Math.hypot(...cb);
    return Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
  };

  const [tl, tr, br, bl] = corners;

  const widthTop = dist(tl, tr);
  const widthBottom = dist(bl, br);
  const heightLeft = dist(tl, bl);
  const heightRight = dist(tr, br);

  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  const ratio = avgHeight / avgWidth;

  // 1. Aspect ratio check (A4 paper is about 1.414)
  if (ratio < 1.3 || ratio > 1.5) return false;

  // 2. Opposite side length similarity check
  if (Math.abs(widthTop - widthBottom) > 40 || Math.abs(heightLeft - heightRight) > 40) return false;

  // 3. Internal angle check
  const angles = [
    angle(tl, tr, br),
    angle(tr, br, bl),
    angle(br, bl, tl),
    angle(bl, tl, tr),
  ];
  if (angles.some(a => a < 80 || a > 100)) return false;

  return true;
}
@Component({
  selector: 'app-scan',
  templateUrl: 'scan.page.html',
  styleUrls: ['scan.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule],
})
export class ScanPage implements AfterViewInit {
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('video', { static: false }) videoRef!: ElementRef<HTMLVideoElement>;

  canvasWidth = 800;
  canvasHeight = Math.round(800 * 1.414);

  latestResultId: number | null = null; // or string, depending on how you save IDs
  latestWarpedMat: any = null;
  classId: number = 0;
  subjectId: number = 0;
  chart: Chart | undefined;
  chartInstance: any = null;
  scannedImageUrl: string | null = null;
  studentPercentage: number = 0;
  classAveragePercentage: number = 0;
  showCamera = false;
  showCroppedImage = false;
  croppedHeaderBase64: string = '';
  fullImageBase64: string = '';
  croppedImageUrl: string | null = null;
  cropOpacity = 1;
  score: number = 0;
  results: Result[] = [];
  detectionBoxes = [
    { x: 0, y: 0, width: 125, height: 125 },
    { x: 0, y: 500, width: 125, height: 125 },
    { x: 355, y: 0, width: 125, height: 125 },
    { x: 355, y: 500, width: 125, height: 125 }
  ];

  detectedContours: any;
  isSheetScanned: boolean = false;
  answers: any[] = [];
  total: number = 0;
  detectedAnswers: { [questionNumber: string]: string | null } = {};
  hasResults: boolean = false;
  examTitle!: string;
  subject!: string;
  gradeLevel!: string;
  cvInitialized = false;

  answerSheets: AnswerSheet[] = [];
  answerKey: { [questionNumber: number]: string } = {};

  // internal OpenCV helpers (optional; only create if needed by your processVideo)
  private srcMat: any = null;
  private cap: any = null;

  constructor(
    private ngZone: NgZone,
    private platform: Platform,
    private router: Router,
    private http: HttpClient,
    private navCtrl: NavController,
    private route: ActivatedRoute,
    private androidPermissions: AndroidPermissions,
    private cameraService: CameraService,
    private preloader: PreloaderService
  ) {}

  async ngAfterViewInit() {
      await this.waitForVideoElement();

      // Load OpenCV
      await this.waitForOpenCV();
            
      // Load answer key from params
      this.route.queryParams.subscribe(params => {
        this.classId = Number(params['classId']);
        this.subjectId = Number(params['subjectId']);
        const subject = LocalDataService.getSubject(this.classId, this.subjectId);
        if (!subject || !subject.answerKey) {
          alert(' No answer key found for this subject!');
          return;
        }
        this.answerKey = {};
        subject.answerKey.forEach((ans: string, idx: number) => {
          this.answerKey[idx + 1] = ans;
        });
        this.total = subject.answerKey.length;
        this.examTitle = params['examTitle'] || '';
        this.subject = params['subject'] || '';
        this.gradeLevel = params['gradeLevel'] || '';
      });
          
      // Start camera only once here
      this.onStartCameraButtonClick();
    }

 private async waitForOpenCV(): Promise<void> {
  while (!(window as any).cv || !(window as any).cv.Mat) {
    await new Promise(res => setTimeout(res, 50));
  }
  console.log(" OpenCV is ready");
}

  private async waitForVideoElement(): Promise<void> {
    while (!this.videoRef || !this.videoRef.nativeElement) {
      await new Promise(res => setTimeout(res, 10));
    }
  }
private initOpenCVMatsAndCapture(videoEl: HTMLVideoElement) {
  if (typeof (window as any).cv !== 'undefined') {
    // Proceed with initialization
  } else {
    console.warn('OpenCV is not available. Please try again later.');
    alert('OpenCV is not available. Please try again later.');
  }
}

  private async ensureCameraPermission(): Promise<boolean> {
    try {
      if (!this.platform.is('android')) return true;

      const perm = this.androidPermissions.PERMISSION.CAMERA;
      const status = await this.androidPermissions.checkPermission(perm);
      if (status?.hasPermission) return true;

      const req = await this.androidPermissions.requestPermission(perm);
      return !!req?.hasPermission;
    } catch (err) {
      console.error('Camera permission check/request failed:', err);
      return false;
    }
  }

  async onStartCameraButtonClick() {
    const ok = await this.ensureCameraPermission();
    if (!ok) {
      alert('Camera permission is required to scan. Please allow camera access in app settings.');
      this.showCamera = false;
      return;
    }

    this.showCamera = true;
    this.startCameraView();
  }

  startCameraView() {
    const videoEl: HTMLVideoElement = this.videoRef?.nativeElement;
    if (!videoEl) {
      console.warn('Video element not ready, retrying...');
      setTimeout(() => this.startCameraView(), 50);
      return;
    }

    this.cameraService.attachToVideo(videoEl).then(() => {
      videoEl.onloadedmetadata = () => {
        videoEl.width = 640;
        videoEl.height = 480;
        this.processVideo();
      };

      if (videoEl.readyState >= 1) {
        videoEl.width = 640;
        videoEl.height = 480;
        this.processVideo();
      }
    }).catch((err: any) => {
      console.error('Camera error:', err);
      const msg = String(err?.message || err);
      if (msg.toLowerCase().includes('permission')) {
        alert('Camera permission denied. Please allow camera access in app settings.');
      } else {
        alert('Error accessing camera: ' + msg);
      }
      this.showCamera = false;
    });
  }

  goToResultViewer() {
    this.router.navigate(['/resultviewer'], {
    state: {
      resultData: {
        score: this.score,
        total: this.total,
        percentage: (this.total > 0 ? (this.score / this.total) * 100 : 0),
        answers: this.results.map(r => ({
          number: r.question,
          selected: r.marked,
          correctAnswer: r.correctAnswer,
          correct: r.correct,
          blank: r.marked === null
        }))
      }
    }
  });
  }

      reset() {
      this.showCamera = false;
      this.showCroppedImage = false;
      this.croppedImageUrl = null;
      this.showDetectionBoxes = true; // re-enable boxes for next scan
      if (this.videoRef?.nativeElement?.srcObject) {
        const stream = this.videoRef.nativeElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        this.videoRef.nativeElement.srcObject = null;
      }
    }

  // New flag at the top of your scan.page.ts
  showDetectionBoxes: boolean = true;

  drawDetectionBoxes(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.showDetectionBoxes) return; // skip drawing entirely
    ctx.save();
    ctx.globalAlpha = 1.0;
    this.detectionBoxes.forEach(box => {
      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    });
    ctx.restore();
  }

  isRectInsideDetectionBoxes(rect: { x: number; y: number; width: number; height: number }) {
    return this.detectionBoxes.some(box => {
      return (
        rect.x >= box.x &&
        rect.y >= box.y &&
        rect.x + rect.width <= box.x + box.width &&
        rect.y + rect.height <= box.y + box.height
      );
    });
  }

    processVideo() {
    try {
        const video = this.videoRef.nativeElement;
        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            alert('Could not get canvas context');
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const edges = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

    const FPS = 10;
    let stopped = false;

    const process = () => {
      if (stopped) return;
      if (!video || video.readyState < 2) {
        requestAnimationFrame(process);
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      this.drawDetectionBoxes(ctx, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      src.data.set(imageData.data);

      cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      cv.threshold(blurred, edges, 60, 255, cv.THRESH_BINARY_INV);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let detectedBoxes = new Array(this.detectionBoxes.length).fill(false);

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);

        if (
          approx.rows === 4 &&
          cv.isContourConvex(approx) &&
          cv.contourArea(approx) > 300 &&  // min size
          cv.contourArea(approx) < 3000    // max size
        ) {
          const rect = cv.boundingRect(approx);

          this.detectionBoxes.forEach((box, idx) => {
            if (
              rect.x >= box.x &&
              rect.y >= box.y &&
              rect.x + rect.width <= box.x + box.width &&
              rect.y + rect.height <= box.y + box.height
            ) {
              detectedBoxes[idx] = true;
              ctx.save();
              ctx.strokeStyle = 'red';
              ctx.lineWidth = 4;
              ctx.globalAlpha = 0.7;
              ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
              ctx.fillStyle = 'rgba(255,0,0,0.2)';
              ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
              ctx.restore();
            }
          });
        }
        approx.delete();
        cnt.delete();
      }

      // In the processVideo function, when all boxes are detected:
      if (detectedBoxes.every(v => v) && !this.croppedImageUrl) {
          stopped = true;
          // REMOVE or COMMENT OUT these lines:
          // this.showCamera = false;  // Hide the camera view
          // if (this.videoRef.nativeElement.srcObject) {
          //     const stream = this.videoRef.nativeElement.srcObject as MediaStream;
          //     stream.getTracks().forEach(track => track.stop());
          // }
          this.detectAndCropPaper();
          return;
      }

      requestAnimationFrame(process);
    };

    requestAnimationFrame(process);
    } catch (error) {
        console.error('Error in processVideo:', error);
    }
    }

async detectAndCropPaper() {
  // Better logger that prints Error.message + stack, not just {}
  const log = (...args: any[]) => {
    const toStr = (a: any) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    };
    const msg = '[detectAndCropPaper] ' + args.map(toStr).join(' ');
    console.log(msg);
    alert(msg);
  };

  try {
    log('step=init');
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) throw new Error('Canvas element not found');

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context missing');

    // Read canvas into OpenCV Mat
    log('step=imread');
    const src = cv.imread(canvas);

    // IMPORTANT: imread(canvas) -> RGBA (4-channel). Use RGBA2GRAY.
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    const markerCorners: { x: number; y: number }[] = [];

    if (!Array.isArray(this.detectionBoxes) || this.detectionBoxes.length === 0) {
      throw new Error('No detectionBoxes found');
    }

    log('step=process_boxes count=' + this.detectionBoxes.length);

    // 🔹 Process detection boxes (used only for warping, NOT drawn later)
    for (const box of this.detectionBoxes) {
      const roi = gray.roi(new cv.Rect(box.x, box.y, box.width, box.height));
      const roiContours = new cv.MatVector();
      const roiHierarchy = new cv.Mat();
      cv.threshold(roi, roi, 90, 255, cv.THRESH_BINARY_INV);
      cv.findContours(roi, roiContours, roiHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      let bestQuad: Array<{x:number;y:number}> | null = null;

      for (let i = 0; i < roiContours.size(); i++) {
        const cnt = roiContours.get(i);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const area = cv.contourArea(approx);
          if (area > 300 && area < 3000 && area > maxArea) {
            maxArea = area;
            bestQuad = [];
            for (let j = 0; j < 4; j++) {
              const pt = approx.data32S.slice(j * 2, j * 2 + 2);
              bestQuad.push({ x: pt[0] + box.x, y: pt[1] + box.y });
            }
          }
        }
        approx.delete();
        cnt.delete();
      }

      if (bestQuad) {
        let target;
        if (box.x < canvas.width / 2 && box.y < canvas.height / 2) target = { x: box.x, y: box.y };
        else if (box.x < canvas.width / 2) target = { x: box.x, y: box.y + box.height };
        else if (box.y < canvas.height / 2) target = { x: box.x + box.width, y: box.y };
        else target = { x: box.x + box.width, y: box.y + box.height };

        let minDist = Infinity, chosen = bestQuad[0];
        for (const pt of bestQuad) {
          const dist = Math.hypot(pt.x - target.x, pt.y - target.y);
          if (dist < minDist) { minDist = dist; chosen = pt; }
        }
        markerCorners.push(chosen);
      } else {
        markerCorners.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      }

      roi.delete();
      roiContours.delete();
      roiHierarchy.delete();
    }
    gray.delete();

    log('step=box_done corners=' + markerCorners.length);
    if (markerCorners.length !== 4) throw new Error(`Detected ${markerCorners.length} corners, expected 4`);

    markerCorners.sort((a, b) => a.y - b.y);
    const top = markerCorners.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = markerCorners.slice(2, 4).sort((a, b) => a.x - b.x);
    const ordered = [top[0], top[1], bottom[1], bottom[0]];

    const FIXED_WIDTH = 800;
    const FIXED_HEIGHT = Math.round(800 * 1.414);

    log('step=warp start');
    const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered[0].x, ordered[0].y,
      ordered[1].x, ordered[1].y,
      ordered[2].x, ordered[2].y,
      ordered[3].x, ordered[3].y
    ]);
    const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,  FIXED_WIDTH, 0,
      FIXED_WIDTH, FIXED_HEIGHT,  0, FIXED_HEIGHT
    ]);
    const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
    const dst = new cv.Mat();
    const dsize = new cv.Size(FIXED_WIDTH, FIXED_HEIGHT);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // ✅ Save warpedMat for processSheet
    if (this.latestWarpedMat) this.latestWarpedMat.delete();
    this.latestWarpedMat = dst.clone();

    // Show warped sheet only (no detection boxes)
    canvas.width = FIXED_WIDTH;
    canvas.height = FIXED_HEIGHT;
    cv.imshow(canvas, dst);

    // 🔹 Disable detection boxes permanently after warp
    this.showDetectionBoxes = false;
    this.detectionBoxes = [];

    // Crop header
    const HEADER_HEIGHT = 250;
    const headerMat = dst.roi(new cv.Rect(0, 0, dst.cols, HEADER_HEIGHT));
    const headerCanvas = document.createElement('canvas');
    headerCanvas.width = headerMat.cols;
    headerCanvas.height = headerMat.rows;
    cv.imshow(headerCanvas, headerMat);
    this.croppedHeaderBase64 = headerCanvas.toDataURL('image/jpeg');
    headerMat.delete();

    log('Header cropped & saved, length:', this.croppedHeaderBase64?.length ?? 0);

    // Process sheet (now has access to latestWarpedMat)
    const overlayCtx = canvas.getContext('2d');
    if (overlayCtx) {
      try {
        log('step=processSheet');
        this.processSheet(overlayCtx);
      } catch (err) {
        log('processSheet error:', err);
      }

      // Score text
      overlayCtx.font = 'bold 32px Arial';
      overlayCtx.fillStyle = 'black';
      overlayCtx.fillText(`Score: ${this.score ?? '-'} / ${this.total ?? '-'}`, 20, 50);

      // Optionally navigate after drawing
      if (typeof this.goToResultViewer === 'function') {
        this.goToResultViewer();
      }
    } else {
      log('No overlayCtx after warp');
    }

    // ✅ Save scan data AFTER processing sheet
    const safeResults = Array.isArray(this.results)
      ? this.results.map(r => ({
          question: r.question,
          marked: r.marked ? String(r.marked) : null,
          correctAnswer: r.correctAnswer ? String(r.correctAnswer) : null,
          correct: r.correct
        }))
      : [];

    const scanData = {
      id: Date.now(),
      headerImage: this.croppedHeaderBase64,
      fullImage: canvas.toDataURL('image/jpeg'),
      answers: safeResults,
      score: this.score ?? null,
      total: this.total ?? null,
      subjectId: this.subjectId ?? null,
      classId: this.classId ?? null,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('scan_' + scanData.id, JSON.stringify(scanData));

    // ✅ Cleanup
    src.delete();
    dst.delete();
    srcPoints.delete();
    dstPoints.delete();
    M.delete();

    log('step=done');
  } catch (err: any) {
    // Show the real error message instead of {}
    const msg = (err && err.message) ? `${err.name || 'Error'}: ${err.message}` : String(err);
    log('Error in detectAndCropPaper:', msg);
    console.error(err);

    this.ngZone.run(() => {
      this.showCroppedImage = false;
      this.croppedImageUrl = null;
      this.hasResults = false;
    });
  }
}

processSheet(ctx: CanvasRenderingContext2D) {
  if (!this.latestWarpedMat || this.latestWarpedMat.empty()) {
    alert("⚠️ processSheet: No warpedMat available.");
    return;
  }

  // Helper: channel-aware gray conversion
  const toGray = (src: any) => {
    const gray = new cv.Mat();
    const code =
      typeof src.channels === "function" && src.channels() === 4
        ? cv.COLOR_RGBA2GRAY
        : cv.COLOR_BGR2GRAY;
    cv.cvtColor(src, gray, code);
    return gray;
  };

  const H = this.latestWarpedMat.rows;
  const W = this.latestWarpedMat.cols;
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);

  this.detectedAnswers = {};
  this.results = [];
  this.score = 0;
  // 🔹 Get TOS rows for this subject
  const subject = LocalDataService.getSubject(this.classId, this.subjectId);
  const tosRows = subject?.tos || [];

  // 🔹 Compute how many items are expected from TOS
  const tosTotal = tosRows.reduce((sum, row) => sum + (row.expectedItems || 0), 0);

  // 🔹 Fallback if no TOS defined, use all bubbles
  const maxItems = tosTotal > 0 ? tosTotal : bubbles.length;
  this.total = maxItems;

  // ✅ Draw warped sheet on your single canvas
  cv.imshow(this.canvasRef.nativeElement, this.latestWarpedMat);

  // ✅ Use same canvas for overlays
  const overlayCtx = this.canvasRef.nativeElement.getContext("2d");
  if (!overlayCtx) return;

  // helper for overlay rings
  const ring = (x: number, y: number, r: number, color: string, lw = 2) => {
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, 2 * Math.PI);
    overlayCtx.lineWidth = lw;
    overlayCtx.strokeStyle = color;
    overlayCtx.stroke();
  };

  let processed = 0;

  for (const bubble of bubbles) {
    if (processed >= maxItems) break;   // ✅ stop once we hit the limit
    const qNum = bubble.question as number;

    // 1) Measure fill ratios
    const ratios: Record<"A" | "B" | "C" | "D", number> = { A: 0, B: 0, C: 0, D: 0 };

    for (const opt of ["A", "B", "C", "D"] as const) {
      let { cx, cy, radius } = bubble.options[opt];

      const side = Math.max(2 * radius, 1);
      const x = Math.max(0, Math.min(W - 1, Math.round(cx - radius)));
      const y = Math.max(0, Math.min(H - 1, Math.round(cy - radius)));
      const w = Math.min(side, W - x);
      const h = Math.min(side, H - y);

      const patch = this.latestWarpedMat.roi(new cv.Rect(x, y, w, h));
      const gray = toGray(patch);

      const bin = new cv.Mat();
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      cv.threshold(gray, bin, 125, 255, cv.THRESH_BINARY_INV);

      const mask = cv.Mat.zeros(h, w, cv.CV_8UC1);
      const rx = Math.min(w, h) / 2 - 1;
      cv.circle(
        mask,
        new cv.Point(Math.round(w / 2), Math.round(h / 2)),
        Math.round(rx),
        new cv.Scalar(255),
        -1
      );

      const masked = new cv.Mat();
      cv.bitwise_and(bin, mask, masked);
      cv.morphologyEx(masked, masked, cv.MORPH_OPEN, kernel);

      const nonZero = cv.countNonZero(masked);
      const totalPixels = Math.PI * rx * rx;
      ratios[opt] = nonZero / totalPixels;

      patch.delete(); gray.delete(); bin.delete();
      mask.delete(); masked.delete();
    }

    // 2) Select best answer
    let selected: Option | null = null;
    let bestRatio = 0.55;
    for (const opt of ["A", "B", "C", "D"] as const) {
      if (ratios[opt] > bestRatio) {
        bestRatio = ratios[opt];
        selected = opt;
      }
    }

    const correctRaw = this.answerKey[qNum];
    const correctAnswer: Option | null = isOption(correctRaw) ? correctRaw : null;
    const isCorrect = !!(selected && correctAnswer && selected === correctAnswer);
    if (isCorrect) this.score++;

    this.detectedAnswers[String(qNum)] = selected ?? null;
    this.results.push({
      question: qNum,
      marked: selected,
      correctAnswer,
      correct: isCorrect,
      topic: bubble.topic ?? null,
      competency: bubble.competency ?? null,
      level: bubble.level ?? null,
    });
    processed++;   // ✅ increment after storing
    // 3) Draw overlays
    for (const opt of ["A", "B", "C", "D"] as const) {
      const { cx, cy, radius } = bubble.options[opt];
      let color = "blue";
      if (opt === selected && opt === correctAnswer) color = "green";
      else if (opt === selected && opt !== correctAnswer) color = "red";
      else if (opt === correctAnswer) color = "yellow";

      ring(cx, cy, radius, color, 2);
    }
  }

  // ✅ Show score text overlay
  overlayCtx.font = 'bold 32px Arial';
  overlayCtx.fillStyle = 'black';
  overlayCtx.fillText(`Score: ${this.score ?? '-'} / ${this.total ?? '-'}`, 20, 50);

  // Final stats
  this.studentPercentage = this.total > 0 ? (this.score / this.total) * 100 : 0;
  this.hasResults = true;

  // ✅ Convert the canvas (with overlays) to DataURL for saving
  let warpedDataUrl = "";
  try {
    warpedDataUrl = this.canvasRef.nativeElement.toDataURL("image/jpeg");
  } catch (e) {
    console.error("Failed to convert warped mat to image:", e);
  }

  // Aggregates
  const computeAnswerDistribution = (answers: AnswerEntry[]) => {
    const counts: Record<'A'|'B'|'C'|'D', number> = { A:0, B:0, C:0, D:0 };
    for (const a of answers) if (a.marked) counts[a.marked]++;
    return counts;
  };

  const computeCognitiveBreakdown = (answers: AnswerEntry[]) => {
    const map: { [level: string]: { correct: number; total: number } } = {};
    for (const a of answers) {
      const lvl = a.level || 'N/A';
      if (!map[lvl]) map[lvl] = { correct: 0, total: 0 };
      map[lvl].total++;
      if (a.correct) map[lvl].correct++;
    }
    return map;
  };

  const answerDistribution = computeAnswerDistribution(this.results);
  const cognitiveBreakdown = computeCognitiveBreakdown(this.results);

  const result: ScannedResult = {
    id: Date.now(),
    headerImage: this.croppedHeaderBase64 ?? "",
    fullImage: warpedDataUrl,
    answers: this.results,
    score: this.score,
    total: this.total,
    subjectId: this.subjectId,
    classId: this.classId,
    timestamp: new Date().toISOString(),
    answerDistribution,
    cognitiveBreakdown,
    // ✅ new: store TOS rows snapshot
    tosRows,
  };

  LocalDataService.saveScannedResult(this.classId, this.subjectId, result);

  kernel.delete();
}

renderAnswerDistributionChart() {
  if (this.chart) {
    this.chart.destroy();
  }
  const questions = Object.keys(this.detectedAnswers).sort((a, b) => +a - +b);
  const answerOptions = ['A', 'B', 'C', 'D'];
  const colors = ['#f44336', '#2196f3', '#4caf50', '#ffeb3b'];

  const answerCounts = questions.map(q => {
    const answer = this.detectedAnswers[q];
    return answerOptions.map(opt => (answer === opt ? 1 : 0));
  });

  const datasets = answerOptions.map((option, idx) => ({
    label: `Option ${option}`,
    data: answerCounts.map(counts => counts[idx]),
    backgroundColor: colors[idx],
  }));

  const ctx = document.getElementById('answersChart') as HTMLCanvasElement;
  if (!ctx) return;

  this.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: questions.map(q => `Q${q}`),
      datasets: datasets,
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Answer Distribution (Scanned Sheet)',
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          title: { display: true, text: 'Selections' },
        },
        x: {
          title: { display: true, text: 'Questions' },
        },
      },
    },
  });
}

processResultsAndShowChart() {
  this.renderAnswerDistributionChart();
}
}