import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import { TeacherService } from '../../services/teacher.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-teacher-settings',
  templateUrl: './teacher-settings.page.html',
  styleUrls: ['./teacher-settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TeacherSettingsPage implements OnInit, OnDestroy {
  currentUser: User | null = null;
  formData = {
    name: '',
    email: '',
    schoolId: '',
    bio: ''
  };
  isLoading = false;
  isSaving = false;
  schools: any[] = [];
  private authSub?: Subscription;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private teacherService: TeacherService,
    private toastController: ToastController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    this.authSub = this.authService.auth$.subscribe(state => {
      this.currentUser = state.user;
    });

    this.loadUserData();
  }



  ngOnDestroy() {
    this.authSub?.unsubscribe();
  }



  ionViewWillEnter() {
    this.loadUserData();
  }

  async loadUserData() {
    this.isLoading = true;
    try {
      if (this.currentUser) {
        this.formData = {
          name: this.currentUser.name || '',
          email: this.currentUser.email || '',
          schoolId: this.currentUser.schoolId ? String(this.currentUser.schoolId) : '',
          bio: ''
        };
      }

      const result = await this.teacherService.getMyProfile();
      if (result.success && result.profile) {
        this.formData = {
          name: String(result.profile.name || this.formData.name || ''),
          email: String(result.profile.email || this.formData.email || ''),
          schoolId: result.profile.schoolId !== undefined ? String(result.profile.schoolId) : (this.formData.schoolId || ''),
          bio: String(result.profile.bio || '')
        };
      }
    } catch (err) {
      console.error('Error loading user data:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async saveProfile() {
    if (!this.formData.name || !this.formData.email) {
      this.showToast('Name and email are required', 'warning');
      return;
    }

    this.isSaving = true;
    try {
      const result = await this.teacherService.updateProfile(this.formData);
      if (result.success) {
        this.showToast('Profile updated successfully!', 'success');

        await this.authService.patchCurrentUser({
          name: this.formData.name,
          email: this.formData.email,
          schoolId: this.formData.schoolId
        });

        this.currentUser = this.authService.getCurrentUser();
      } else {
        this.showToast(result.error || 'Failed to update profile', 'danger');
      }
    } catch (err: any) {
      console.error('Error updating profile:', err);
      this.showToast(err.message || 'Failed to update profile', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  goBack() {
    this.navCtrl.back();
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top',
      color
    });
    await toast.present();
  }
}
