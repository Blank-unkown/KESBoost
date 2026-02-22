import { Component, OnInit, AfterViewInit, OnDestroy, QueryList, ViewChildren, ElementRef } from '@angular/core';
import { NavController, AlertController, MenuController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import { TeacherService, ClassData } from '../../services/teacher.service';
import { Gesture, GestureController } from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';

export interface DashboardData {
  totalClasses: number;
  totalStudents: number;
  totalSubjects: number;
  averageScore: number;
  classes: ClassData[];
  recentExams?: any[];
}

@Component({
  selector: 'app-teacher-dashboard',
  templateUrl: './teacher-dashboard.page.html',
  styleUrls: ['./teacher-dashboard.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TeacherDashboardPage implements OnInit, AfterViewInit, OnDestroy {
  currentUser: User | null = null;
  dashboardData: DashboardData | null = null;
  isLoading = false;
  classes: ClassData[] = [];
  private gestures: Gesture[] = [];
  private suppressNextClassClick = false;
  private classOrderIds: number[] = [];

  @ViewChildren('classCard', { read: ElementRef }) classCards?: QueryList<ElementRef<HTMLElement>>;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private teacherService: TeacherService,
    private alertController: AlertController,
    private menuController: MenuController,
    private toastController: ToastController,
    private gestureCtrl: GestureController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }



  onClassCardClick(classId: number) {
    if (this.suppressNextClassClick) {
      this.suppressNextClassClick = false;
      return;
    }

    this.navigateToClass(classId);
  }

  ngOnInit() {
    this.loadData();
  }



  async ngAfterViewInit() {
    await this.loadClassOrder();

    this.classCards?.changes.subscribe(() => {
      this.attachReorderGestures();
    });

    this.attachReorderGestures();
  }



  ngOnDestroy() {
    this.destroyGestures();
  }

  async loadData() {
    this.isLoading = true;
    try {
      this.classes = await this.teacherService.getClasses();
      this.calculateDashboardData();
    } catch (err) {
      console.error('Error loading dashboard:', err);
      await this.showToast('Failed to load dashboard data', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  private calculateDashboardData() {
    let totalStudents = 0;
    let totalSubjects = 0;
    const subjectSet = new Set<string>();

    // Calculate totals from real class data
    this.classes.forEach(cls => {
      totalStudents += cls.student_count || 0;
      if (cls.subjects && cls.subjects.length > 0) {
        cls.subjects.forEach(sub => {
          subjectSet.add(`${sub.name}-${cls.id}`);
        });
      }
    });

    const displayClasses = this.applyClassOrder(this.classes).slice(0, 5);

    this.dashboardData = {
      totalClasses: this.classes.length,
      totalStudents,
      totalSubjects: subjectSet.size,
      averageScore: 0, // To be fetched from exam results if available
      classes: displayClasses, // Show first 5 classes
      recentExams: []
    };
  }



  private async loadClassOrder(): Promise<void> {
    try {
      const stored = await Preferences.get({ key: 'teacherClassOrder' });
      const raw = (stored.value || '').trim();
      if (!raw) {
        this.classOrderIds = [];
        return;
      }

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.classOrderIds = parsed
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
      } else {
        this.classOrderIds = [];
      }
    } catch {
      this.classOrderIds = [];
    }
  }



  private applyClassOrder(list: ClassData[]): ClassData[] {
    if (!this.classOrderIds.length) return list;

    const pos = new Map<number, number>();
    this.classOrderIds.forEach((id, i) => pos.set(Number(id), i));

    return [...list].sort((a, b) => {
      const pa = pos.get(Number(a.id));
      const pb = pos.get(Number(b.id));
      const na = pa === undefined ? Number.MAX_SAFE_INTEGER : pa;
      const nb = pb === undefined ? Number.MAX_SAFE_INTEGER : pb;
      return na - nb;
    });
  }



  private destroyGestures() {
    this.gestures.forEach(g => {
      try {
        g.destroy();
      } catch {
        // ignore
      }
    });
    this.gestures = [];
  }



  private attachReorderGestures() {
    this.destroyGestures();

    const cards = this.classCards?.toArray() || [];
    if (!cards.length) return;

    cards.forEach((ref) => {
      const el = ref.nativeElement;
      const classIdRaw = el.getAttribute('data-class-id');
      const classId = classIdRaw ? Number(classIdRaw) : NaN;
      if (!classIdRaw || Number.isNaN(classId)) return;

      let holdTimer: any;
      let dragging = false;
      let moved = false;
      let lastDx = 0;

      const gesture = this.gestureCtrl.create({
        el,
        gestureName: 'class-reorder',
        threshold: 0,
        onStart: () => {
          moved = false;
          dragging = false;
          lastDx = 0;

          holdTimer = setTimeout(() => {
            dragging = true;
            this.suppressNextClassClick = true;
            el.style.transition = 'none';
            el.style.zIndex = '1000';
          }, 350);
        },
        onMove: (detail) => {
          if (!dragging) {
            if (Math.abs(detail.deltaX) > 10 || Math.abs(detail.deltaY) > 10) {
              clearTimeout(holdTimer);
            }
            return;
          }

          moved = true;
          lastDx = detail.deltaX;
          el.style.transform = `translateX(${lastDx}px)`;
        },
        onEnd: () => {
          clearTimeout(holdTimer);

          if (dragging) {
            const baseRect = el.getBoundingClientRect();
            const draggedCenterX = (baseRect.left + baseRect.width / 2) + lastDx;

            if (moved) {
              this.reorderByDropPosition(classId, draggedCenterX);
            }

            try {
              el.style.transition = '';
              el.style.transform = '';
              el.style.zIndex = '';
            } catch {
              // ignore
            }

            setTimeout(() => {
              this.suppressNextClassClick = false;
            }, 350);
          }
        }
      });

      gesture.enable(true);
      this.gestures.push(gesture);
    });
  }



  private async reorderByDropPosition(classId: number, draggedCenterX: number): Promise<void> {
    const ordered = this.applyClassOrder(this.classes);
    const fromIndex = ordered.findIndex(c => Number(c.id) === Number(classId));
    if (fromIndex < 0) return;

    const cards = this.classCards?.toArray() || [];
    const cardEls = cards.map(r => r.nativeElement);
    const rects = cardEls.map(el => el.getBoundingClientRect());

    let toCardIndex = -1;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const cx = r.left + r.width / 2;
      if (draggedCenterX < cx) {
        toCardIndex = i;
        break;
      }
    }
    if (toCardIndex < 0) {
      toCardIndex = rects.length - 1;
    }

    // Map drop index in visible cards to index in full ordered list (we only render first 5)
    const visible = (this.dashboardData?.classes || []).map(c => Number(c.id));
    const toId = visible[toCardIndex];
    const toIndex = toId !== undefined ? ordered.findIndex(c => Number(c.id) === Number(toId)) : fromIndex;

    if (toIndex < 0 || toIndex === fromIndex) {
      return;
    }

    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    this.classes = next;
    this.classOrderIds = next.map(c => Number(c.id));
    await Preferences.set({ key: 'teacherClassOrder', value: JSON.stringify(this.classOrderIds) });

    this.calculateDashboardData();
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

  goToSettings() {
    this.menuController.close();
    this.navCtrl.navigateForward('/teacher-settings');
  }

  navigateToClass(classId: number) {
    this.navCtrl.navigateForward(`/subject-list/${classId}`);
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

  async refreshData() {
    await this.loadData();
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
}
