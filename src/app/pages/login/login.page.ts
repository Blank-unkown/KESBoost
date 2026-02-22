import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email = '';
  password = '';
  isLoading = false;
  showPassword = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {}

  async login() {
    if (!this.email || !this.password) {
      this.showToast('Please fill in all fields');
      return;
    }

    this.isLoading = true;
    const result = await this.authService.login(this.email, this.password);

    if (result.success) {
      this.showToast('Login successful!');
      this.router.navigate(['/dashboard']);
    } else {
      this.showToast(result.message);
    }

    this.isLoading = false;
  }

  goToRegister() {
    this.router.navigate(['/register']);
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top'
    });
    await toast.present();
  }
}
