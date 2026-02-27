import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, Platform, AlertController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { CameraService } from '../../services/camera.service';
import { TeacherService } from '../../services/teacher.service';
import { LocalDataService } from '../../services/local-data.service';
import { bubbles, BubbleTemplate, Option } from '../../data/bubble-template';
import { OmrLiteService } from '../../services/omr-lite.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

interface GradingResult {
  questionNumber: number;
  detectedAnswer: string | null;
  correctAnswer: string;
  status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
  confidence?: number;
}

@Component({
  selector: 'app-scan',
  templateUrl: './scan.page.html',
  styleUrls: ['./scan.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, HttpClientModule]
})
export class ScanPage implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  // OMR Config
  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131; // A4 aspect ratio
  readonly QUESTIONS_COUNT = 50;
  readonly OPTIONS_COUNT = 4; // A, B, C, D
  readonly FILL_THRESHOLD = 0.25; // 25% fill means marked

  // State
  isProcessing = false;
  showResults = false;
  statusMessage = 'Initializing...';
  lastError = '';
  debugMode = false;

  // Data
  classId = 0;
  subjectId = 0;
  examTitle = 'Exam Results';
  answerKey: string[] = [];
  gradingResults: GradingResult[] = [];
  
  // Stats
  score = 0;
  total = 0;
  correctCount = 0;
  incorrectCount = 0;
  blankCount = 0;
  invalidCount = 0;

  // Real-time tracking state
  detectedMarkers: { [key: string]: { x: number, y: number } | null } = {
    tl: null, tr: null, br: null, bl: null
  };
  autoCaptureCount = 0;
  readonly AUTO_CAPTURE_THRESHOLD = 8; // Faster capture for shaky hands (approx 0.5s)

  // Soft-lock memory (remembers a marker for a few frames if it flickers)
  markerMemory: { [key: string]: { pos: { x: number, y: number }, frames: number } } = {
    tl: { pos: { x: 0, y: 0 }, frames: 0 },
    tr: { pos: { x: 0, y: 0 }, frames: 0 },
    br: { pos: { x: 0, y: 0 }, frames: 0 },
    bl: { pos: { x: 0, y: 0 }, frames: 0 }
  };
  readonly MEMORY_LIFE = 10; // Remember a lost marker for 10 frames

  private streamActive = false;
  private animationFrameId: number | null = null;

  constructor(
    private cameraService: CameraService,
    private teacherService: TeacherService,
    private omrLite: OmrLiteService,
    private route: ActivatedRoute,
    private ngZone: NgZone,
    private alertCtrl: AlertController
  ) {}

  async ngAfterViewInit() {
    this.route.queryParams.subscribe(params => {
      this.classId = Number(params['classId'] || 0);
      this.subjectId = Number(params['subjectId'] || 0);
      void this.initScanner();
    });
  }

  ngOnDestroy() {
    this.stopScanner();
  }

  async initScanner() {
    this.statusMessage = 'Initializing...';
    
    // 1. Start camera immediately so user sees something
    try {
      await this.startCamera();
      this.statusMessage = 'Ready to scan';
      this.isProcessing = false;
    } catch (e: any) {
      console.error('Camera failed', e);
      this.lastError = 'Camera access denied or failed.';
      return; 
    }

    // 2. Load answer key
    await this.loadAnswerKey();
  }

  async loadAnswerKey() {
    const res = await this.teacherService.loadSubjectAnswerKey(this.classId, this.subjectId);
    if (res.success && res.answerKey && res.answerKey.length > 0) {
      // Ensure we have exactly 50 entries if the template expects 50
      this.answerKey = res.answerKey;
      if (this.answerKey.length < 50) {
        const padding = Array(50 - this.answerKey.length).fill('A');
        this.answerKey = [...this.answerKey, ...padding];
      }
    } else {
      // Fallback/Mock for development - Ensure 50 items
      this.answerKey = Array(50).fill('A').map((_, i) => ['A','B','C','D'][i % 4]);
      console.warn('Using 50-item mock answer key');
    }
    this.total = this.answerKey.length;
  }

  async startCamera() {
    try {
      await this.cameraService.attachToVideo(this.videoRef.nativeElement);
      this.streamActive = true;
      this.startPreviewLoop();
    } catch (e: any) {
      console.error('Camera access failed:', e);
      this.ngZone.run(() => {
        this.lastError = e.message || 'Camera access denied';
      });
      throw e;
    }
  }

  stopScanner() {
    this.streamActive = false;
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    void this.cameraService.stopStream();
  }

  startPreviewLoop() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const loop = () => {
      if (!this.streamActive) return;
      
      if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        // REAL-TIME MARKER TRACKING
        if (!this.showResults && !this.isProcessing) {
          this.trackMarkers(ctx, canvas.width, canvas.height);
        }
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private trackMarkers(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const quadrants = this.omrLite.getQuadrants(width, height);
    
    let foundAll = true;
    const newMarkers: any = {};

    for (const quad of quadrants) {
      const marker = this.omrLite.findNestedMarker(data, width, height, quad);
      
      if (marker) {
        // We found it! Update memory
        this.markerMemory[quad.id] = { pos: marker.center, frames: this.MEMORY_LIFE };
        newMarkers[quad.id] = marker.center;
      } else {
        // We lost it! Check memory
        if (this.markerMemory[quad.id].frames > 0) {
          this.markerMemory[quad.id].frames--;
          newMarkers[quad.id] = this.markerMemory[quad.id].pos;
        } else {
          newMarkers[quad.id] = null;
          foundAll = false;
        }
      }
    }

    // Update UI state in Angular zone
    this.ngZone.run(() => {
      this.detectedMarkers = newMarkers;
      
      if (foundAll) {
        this.autoCaptureCount++;
        this.statusMessage = `HOLD STILL... ${Math.round((this.autoCaptureCount / this.AUTO_CAPTURE_THRESHOLD) * 100)}%`;
        
        // Auto-capture when stable
        if (this.autoCaptureCount >= this.AUTO_CAPTURE_THRESHOLD) {
          this.autoCaptureCount = 0;
          // IMPORTANT: Before capturing, clear memory to ensure we use real data for grading
          Object.keys(this.markerMemory).forEach(k => this.markerMemory[k].frames = 0);
          void this.capture();
        }
      } else {
        this.autoCaptureCount = 0;
        this.statusMessage = 'BRING SHEET CLOSER';
      }
    });
  }

  toggleDebug() {
    this.debugMode = !this.debugMode;
  }

  async capture() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.statusMessage = 'Scanning OMR...';
    this.lastError = '';
    
    // Give UI a moment to update
    await new Promise(res => setTimeout(res, 100));

    try {
      const canvas = this.canvasRef.nativeElement;
      const result = this.omrLite.processFrame(canvas, this.answerKey);
      
      this.ngZone.run(() => {
        this.gradingResults = result;
        this.calculateStats();
        this.showResults = true;
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
      });
    } catch (e: any) {
      console.error('OMR Lite Error', e);
      this.ngZone.run(() => {
        this.lastError = e.message || 'Detection failed';
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
        
        // If it failed, check if it's a "No sheet found" error
        if (e.message.includes('markers')) {
          this.lastError = 'Sheet not visible. Please align corner markers.';
        }
      });
    }
  }

  async takePhoto() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.statusMessage = 'Launching camera...';
    this.lastError = '';

    try {
      const image = await Camera.getPhoto({
        quality: 100,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        this.statusMessage = 'Processing photo...';
        
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            try {
              const result = this.omrLite.processFrame(canvas, this.answerKey);
              this.ngZone.run(() => {
                this.gradingResults = result;
                this.calculateStats();
                this.showResults = true;
                this.isProcessing = false;
                this.statusMessage = 'Ready to scan';
              });
            } catch (err: any) {
              this.ngZone.run(() => {
                this.lastError = err.message || 'Photo processing failed';
                if (err.message.includes('markers')) {
                  this.lastError = 'Corner markers not detected in photo.';
                }
                this.isProcessing = false;
                this.statusMessage = 'Ready to scan';
              });
            }
          }
        };
        img.src = image.webPath;
      }
    } catch (e: any) {
      console.error('Photo error', e);
      this.ngZone.run(() => {
        this.lastError = 'Photo capture cancelled or failed';
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
      });
    }
  }

  correctResult(index: number, event: any) {
    const newVal = event.detail.value;
    const r = this.gradingResults[index];
    r.detectedAnswer = newVal;
    
    if (!newVal) {
      r.status = 'Blank';
    } else {
      r.status = newVal === r.correctAnswer ? 'Correct' : 'Incorrect';
    }
    
    this.calculateStats();
  }

  // Remove the old OpenCV based methods as they are no longer used
  // canvasToMat, processOMR, detectAndWarp, sortCorners, gradeBubblesFromTemplate can be removed or kept as backups.


  calculateStats() {
    this.correctCount = this.gradingResults.filter(r => r.status === 'Correct').length;
    this.incorrectCount = this.gradingResults.filter(r => r.status === 'Incorrect').length;
    this.blankCount = this.gradingResults.filter(r => r.status === 'Blank').length;
    this.invalidCount = this.gradingResults.filter(r => r.status === 'Invalid').length;
    this.score = this.correctCount;
  }

  resetScanner() {
    this.showResults = false;
    this.gradingResults = [];
    this.score = 0;
    this.lastError = '';
    this.startCamera();
  }
}

