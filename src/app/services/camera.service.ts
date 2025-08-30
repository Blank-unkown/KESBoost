import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private stream: MediaStream | null = null;
  private streamPromise: Promise<MediaStream> | null = null;

  /**
   * Get a MediaStream for the environment-facing camera.
   * Reuses existing stream if it's still live.
   */
  async getStream(): Promise<MediaStream> {
    // If we already have a live stream, reuse it
    if (this.stream && this.isStreamActive()) {
      return this.stream;
    }

    // If there's already a pending request, return it
    if (this.streamPromise) return this.streamPromise;

    console.log('📷 Requesting camera access...');
    this.streamPromise = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 }
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
    videoEl.srcObject = stream;
    await videoEl.play();
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
