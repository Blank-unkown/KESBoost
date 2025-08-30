import { Component } from '@angular/core';
import { LocalDataService } from './services/local-data.service';
import { Platform } from '@ionic/angular';
import { PreloaderService } from './services/preloader.service';
import { CameraService } from './services/camera.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    private platform: Platform,
    private preloaderService: PreloaderService,
    private cameraService: CameraService
  ) {
    this.initializeApp();
  }

  async initializeApp() {
    await LocalDataService.load();

    // Wait for platform to be ready
    await this.platform.ready();

    // 1️⃣ Preload OpenCV.js
    await this.preloaderService.loadOpenCV();
    console.log('✅ OpenCV.js preloaded');

    // 2️⃣ Warm up the camera
    try {
      await this.cameraService.getStream();
      console.log('✅ Camera preloaded');
    } catch (err) {
      console.error('❌ Camera preload failed:', err);
    }
  }
}
