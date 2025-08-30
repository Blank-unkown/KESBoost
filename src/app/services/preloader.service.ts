import { Injectable } from '@angular/core';
import { CameraService } from './camera.service';

@Injectable({ providedIn: 'root' })
export class PreloaderService {
  private opencvReady = false;

  constructor(private cameraService: CameraService) {}

  /**
   * Wait for OpenCV to be ready. If the global flag was already set or
   * cv object looks initialized, resolves immediately. Includes a timeout
   * fallback (resolves rather than rejects) so your app can continue.
   */
  loadOpenCV(timeoutMs = 15000): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.opencvReady) return resolve();

      // If index.html already set a global quick flag (recommended)
      if ((window as any).__cvReady === true) {
        this.opencvReady = true;
        return resolve();
      }

      // If cv object already looks initialized (best-effort check)
      if ((window as any).cv && (window as any).cv.Mat) {
        this.opencvReady = true;
        return resolve();
      }

      const onReady = () => {
        this.opencvReady = true;
        cleanup();
        console.log('✅ OpenCV signaled ready (cvReady event).');
        resolve();
      };

      // If the event fires, we'll resolve.
      window.addEventListener('cvReady', onReady);

      // Timeout fallback: resolve after timeout (app can still run; log a warning)
      const timeout = setTimeout(() => {
        cleanup();
        if (!this.opencvReady) {
          console.warn(`⚠️ OpenCV did not signal ready within ${timeoutMs}ms — continuing anyway.`);
        }
        resolve();
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener('cvReady', onReady);
      }
    });
  }

  /**
   * Warm the camera by calling CameraService.getStream().
   * If permission is denied or camera fails, this function will catch and log,
   * but will not throw — so preloading won't crash the app.
   */
  async loadCamera(): Promise<void> {
    try {
      await this.cameraService.getStream();
      console.log('✅ Camera warmed up (stream obtained)');
    } catch (err) {
      console.error('❌ Failed to warm up camera:', err);
    }
  }

  /**
   * Preload both OpenCV and camera in parallel. Uses allSettled so both
   * attempts are allowed to fail independently and we still resolve.
   */
  async preloadAll(): Promise<void> {
    const results = await Promise.allSettled([
  this.loadOpenCV(),
  this.cameraService.getStream()
]);

results.forEach((r: PromiseSettledResult<any>, i: number) => {
  if (r.status === "fulfilled") {
    console.log(`✅ Preload step ${i + 1} succeeded`);
  } else {
    console.warn(`⚠️ Preload step ${i + 1} failed:`, r.reason);
  }
});



    console.log('🚀 Preloader finished (OpenCV + Camera attempts done)');
  }

  /**
   * Optional: quick helper to check if OpenCV has already been marked ready.
   */
  isOpenCVReady(): boolean {
    return this.opencvReady || ((window as any).__cvReady === true) || !!((window as any).cv && (window as any).cv.Mat);
  }
}
