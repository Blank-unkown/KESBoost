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
  loginSuccess = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {}

  async login() {
    if (!this.email || !this.password) {
      await this.showToast('Please fill in all fields');
      return;
    }

    this.isLoading = true;
    const result = await this.authService.login(this.email, this.password);

    if (result.success) {
      this.loginSuccess = true;

      const user = this.authService.getCurrentUser();
      let target = '/teacher-dashboard';
      if (user?.userType === 'admin' || user?.userType === 'school') {
        target = '/admin-dashboard';
      } else if (user?.userType && user.userType !== 'teacher') {
        target = '/student-dashboard';
      }

      setTimeout(() => {
        void this.router.navigate([target]);
      }, 700);
    } else {
      await this.showToast(result.message);
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
