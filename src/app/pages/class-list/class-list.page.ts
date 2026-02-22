import { Component, OnInit } from '@angular/core';
import { NavController, IonContent, ToastController, MenuController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TeacherService, ClassData } from '../../services/teacher.service';
import { AuthService, User } from '../../services/auth.service';

@Component({
  selector: 'app-class-list',
  templateUrl: './class-list.page.html',
  styleUrls: ['./class-list.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class ClassListPage implements OnInit {
  className = '';
  gradeLevel = '';
  classes: ClassData[] = [];
  isLoading = false;
  showAddForm = false;
  currentUser: User | null = null;

  constructor(
    private navCtrl: NavController,
    private teacherService: TeacherService,
    private toastController: ToastController,
    private authService: AuthService,
    private menuController: MenuController,
    private alertController: AlertController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  async ionViewWillEnter() {
    try {
      await this.menuController.enable(false);
      await this.menuController.enable(true, 'classListMenu');
    } catch (err) {
      console.error('Failed to enable menu for class list:', err);
    }
  }

  async ngOnInit() {
    await this.loadClasses();
  }

  async loadClasses() {
    this.isLoading = true;
    try {
      this.classes = await this.teacherService.getClasses();
    } catch (err) {
      await this.showToast('Failed to load classes', 'danger');
      console.error('Error loading classes:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async addClass() {
    if (!this.className.trim()) {
      await this.showToast('Please enter a class name', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      const result = await this.teacherService.createClass(
        this.className,
        this.gradeLevel
      );

      if (result.success) {
        await this.showToast('Class created successfully!', 'success');
        this.className = '';
        this.gradeLevel = '';
        this.showAddForm = false;
        await this.loadClasses();
      } else {
        await this.showToast(result.error || 'Failed to create class', 'danger');
      }
    } catch (err) {
      await this.showToast('Error creating class', 'danger');
      console.error('Error creating class:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async deleteClass(classId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    const confirmed = confirm('Are you sure you want to delete this class?');
    if (!confirmed) return;

    this.isLoading = true;
    try {
      const result = await this.teacherService.deleteClass(classId);
      if (result.success) {
        await this.showToast('Class deleted successfully!', 'success');
        await this.loadClasses();
      } else {
        await this.showToast(result.error || 'Failed to delete class', 'danger');
      }
    } catch (err) {
      await this.showToast('Error deleting class', 'danger');
      console.error('Error deleting class:', err);
    } finally {
      this.isLoading = false;
    }
  }

  goToSubjects(classId: number) {
    this.navCtrl.navigateForward(`/subject-list/${classId}`);
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  toggleAddForm() {
    this.showAddForm = !this.showAddForm;
  }

  getTotalStudents(): number {
    return this.classes.reduce((total, cls) => total + (cls.student_count || 0), 0);
  }

  // Navigation Methods
  goToDashboard() {
    this.menuController.close();
    this.navCtrl.navigateRoot('/teacher-dashboard');
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

  goToSettings() {
    this.menuController.close();
    this.navCtrl.navigateForward('/teacher-settings');
  }

  closeMenu() {
    this.menuController.close();
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
}