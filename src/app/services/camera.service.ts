import { Injectable } from '@angular/core';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private stream: MediaStream | null = null;
  private streamPromise: Promise<MediaStream> | null = null;

  /**
   * Get a MediaStream for the environment-facing camera.
   * Reuses existing stream if it's still live.
   */
  async getStream(): Promise<MediaStream> {
    // 1. Check/Request permissions for native Android/iOS
    if (Capacitor.isNativePlatform()) {
      const status = await Camera.checkPermissions();
      if (status.camera !== 'granted') {
        const request = await Camera.requestPermissions();
        if (request.camera !== 'granted') {
          throw new Error('Camera permission not granted');
        }
      }
    }

    // 2. If we already have a live stream, reuse it
    if (this.stream && this.isStreamActive()) {
      return this.stream;
    }

    // 3. If there's already a pending request, return it
    if (this.streamPromise) return this.streamPromise;

    console.log('📷 Requesting camera access...');
    this.streamPromise = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 }, // Higher resolution for better OMR
        height: { ideal: 720 }
      },
      audio: false
    }).then((stream: MediaStream) => {
      console.log('✅ Camera stream obtained');
      this.stream = stream;
      this.streamPromise = null;
      return stream;
    }).catch(err => {
      console.error('❌ Camera access failed:', err);
      this.streamPromise = null;
      throw err;
    });

    return this.streamPromise;
  }

  /**
   * Attach the stream to a given HTMLVideoElement.
   */
  async attachToVideo(videoEl: HTMLVideoElement): Promise<void> {
    if (!videoEl) {
      throw new Error('Video element is missing!');
    }
    const stream = await this.getStream();

    // Android WebView / mobile browsers often require muted + playsInline for autoplay.
    videoEl.autoplay = true;
    videoEl.muted = true;
    (videoEl as any).playsInline = true;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.setAttribute('webkit-playsinline', 'true');

    videoEl.srcObject = stream;

    // Wait for metadata so videoWidth/videoHeight are available and play is allowed.
    await new Promise<void>((resolve) => {
      if (videoEl.readyState >= 1) return resolve();
      videoEl.onloadedmetadata = () => resolve();
    });

    try {
      await videoEl.play();
    } catch (e) {
      // Retry once after a short delay (some devices need a moment after srcObject assignment)
      await new Promise(res => setTimeout(res, 150));
      await videoEl.play();
    }

    console.log('🎥 Video element is now playing');
  }

  /**
   * Stop the active camera stream and release resources.
   */
  async stopStream(): Promise<void> {
    if (this.stream) {
      console.log('🛑 Stopping camera stream...');
      this.stream.getTracks().forEach(track => {
        try { track.stop(); } catch { /* ignore */ }
      });
      this.stream = null;
    }
    this.streamPromise = null;
  }

  /**
   * Check if there is an active, live camera stream.
   */
  isStreamActive(): boolean {
    return !!(this.stream && this.stream.getTracks().some(t => t.readyState === 'live'));
  }
}
