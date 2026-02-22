import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class DashboardPage {
  constructor(
    private navCtrl: NavController,
    private authService: AuthService
  ) {
    this.redirectToDashboard();
  }

  redirectToDashboard() {
    const user = this.authService.getCurrentUser();
    
    if (!user) {
      this.navCtrl.navigateRoot('/login');
      return;
    }

    // Route based on user type
    if (user.userType === 'teacher') {
      this.navCtrl.navigateRoot('/teacher-dashboard');
    } else if (user.userType === 'school' || user.userType === 'admin') {
      this.navCtrl.navigateRoot('/admin-dashboard');
    } else {
      // Default: student dashboard
      this.navCtrl.navigateRoot('/student-dashboard');
    }
  }

  goToClasses() {
    this.navCtrl.navigateForward('/class-list');
  }
}
