import { Component, OnInit } from '@angular/core';
import { NavController, AlertController, MenuController } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import { DashboardService, DashboardStats } from '../../services/dashboard.service';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false
})
export class AdminDashboardPage implements OnInit {
  currentUser: User | null = null;
  dashboardStats: DashboardStats | null = null;
  isLoading = false;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private dashboardService: DashboardService,
    private alertController: AlertController,
    private menuController: MenuController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.isLoading = true;
    await this.dashboardService.loadDashboardData();
    this.dashboardStats = this.dashboardService.getDashboardStats();
    this.isLoading = false;
  }

  // Navigate to different sections
  goToDashboard() {
    this.menuController.close();
  }

  goToClasses() {
    this.menuController.close();
    this.navCtrl.navigateForward('/class-list');
  }

  goToScan() {
    this.menuController.close();
    this.navCtrl.navigateForward('/scan');
  }

  goToResults() {
    this.menuController.close();
    this.navCtrl.navigateForward('/resultviewer');
  }

  goToAnswerKey() {
    this.menuController.close();
    this.navCtrl.navigateForward('/answer-key/0/0');
  }

  goToQuestionGenerator() {
    this.menuController.close();
    this.navCtrl.navigateForward('/question-generator/0/0');
  }

  goToTeachers() {
    this.menuController.close();
    // Navigate to teachers management page (to be created)
    // this.navCtrl.navigateForward('/teachers');
  }

  goToSchoolSettings() {
    this.menuController.close();
    // Navigate to school settings (to be created)
    // this.navCtrl.navigateForward('/school-settings');
  }

  async logout() {
    const alert = await this.alertController.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to logout?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Logout',
          handler: async () => {
            await this.authService.logout();
            this.navCtrl.navigateRoot('/login');
          }
        }
      ]
    });

    await alert.present();
  }

  refreshData() {
    this.loadData();
  }
}
