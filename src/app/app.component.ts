import { Component } from '@angular/core';
import { LocalDataService } from './services/local-data.service';
import { AuthService } from './services/auth.service';
import { Platform } from '@ionic/angular';
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
    private cameraService: CameraService,
    private authService: AuthService
  ) {
    this.initializeApp();
  }

  async initializeApp() {
    try {
      await LocalDataService.load();
    } catch (err) {
      console.error('LocalDataService load error:', err);
    }

    try {
      await this.authService.checkAuth();
    } catch (err) {
      console.error('AuthService checkAuth error:', err);
    }

    // Wait for platform to be ready
    await this.platform.ready();
  }
}
