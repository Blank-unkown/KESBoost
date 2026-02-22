import { Component, OnInit } from '@angular/core';
import { NavController, MenuController, AlertController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { LocalDataService, ScannedResult } from '../../services/local-data.service';
import { AuthService, User } from '../../services/auth.service';
import { TeacherService, Subject } from '../../services/teacher.service';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-subject-list',
  templateUrl: './subject-list.page.html',
  styleUrls: ['./subject-list.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class SubjectListPage implements OnInit {
  classId!: number;
  subjectId!: number;
  subjects: Subject[] = [];
  subjectName = '';
  subjectCode = '';
  subjectDescription = '';
  subjectTotalMarks: number | null = 100;
  isSaving = false;
  currentUser: User | null = null;

  results: ScannedResult[] = [];
  meanPercentage = 0;
  scoreDistribution: { range: string; count: number }[] = [];
  competencyBreakdown: Record<string, { correct: number; total: number }> = {};
  showAnalysis = false;

  aggregatedAnswerDist: { A: number; B: number; C: number; D: number } = { A: 0, B: 0, C: 0, D: 0 };
  aggregatedCognitive: { [level: string]: { correct: number; total: number } } = {};

  private aggAnswersChart?: Chart;
  private aggCognitiveChart?: Chart;
  private scoreChart?: Chart;
  private competencyChart?: Chart;

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private router: Router,
    private authService: AuthService,
    private teacherService: TeacherService,
    private menuController: MenuController,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  async ngOnInit() {
    this.classId = Number(this.route.snapshot.paramMap.get('id'));
    await this.loadSubjects();
  }

  async loadSubjects() {
    try {
      this.subjects = await this.teacherService.getClassSubjects(this.classId);
    } catch (err) {
      await this.showToast('Failed to load subjects', 'danger');
      console.error('Failed to load subjects:', err);
    }
  }

  openStudents(subject: Subject) {
    this.navCtrl.navigateForward(`/class-students/${this.classId}/${subject.id}`, {
      queryParams: {
        subjectName: subject.name
      }
    });
  }

  async addSubject() {
    if (!this.subjectName.trim()) {
      await this.showToast('Please enter a subject name', 'warning');
      return;
    }

    this.isSaving = true;
    try {
      const result = await this.teacherService.createSubject({
        name: this.subjectName.trim(),
        code: this.subjectCode.trim() || undefined,
        class_id: this.classId,
        description: this.subjectDescription.trim() || undefined,
        total_marks: this.subjectTotalMarks ?? undefined
      });

      if (result.success && result.subject) {
        await this.showToast('Subject added successfully!', 'success');
        this.subjectName = '';
        this.subjectCode = '';
        this.subjectDescription = '';
        this.subjectTotalMarks = 100;
        await this.loadSubjects();
      } else {
        await this.showToast(result.error || 'Failed to add subject', 'danger');
      }
    } catch (err) {
      await this.showToast('Error adding subject', 'danger');
      console.error('Error adding subject:', err);
    } finally {
      this.isSaving = false;
    }
  }

  async deleteSubject(subjectId: number) {
    const confirmed = confirm('Are you sure you want to delete this subject?');
    if (!confirmed) return;

    try {
      const result = await this.teacherService.deleteSubject(this.classId, subjectId);
      if (result.success) {
        await this.showToast('Subject deleted successfully!', 'success');
        await this.loadSubjects();
      } else {
        await this.showToast(result.error || 'Failed to delete subject', 'danger');
      }
    } catch (err) {
      await this.showToast('Error deleting subject', 'danger');
      console.error('Error deleting subject:', err);
    }
  }

  goToTOS(subjectId: number) {
    this.navCtrl.navigateForward(`/tos/${this.classId}/${subjectId}`);
  }

  goToScannedResults(subjectId: number) {
    this.subjectId = subjectId;
    this.results = LocalDataService.getResultsBySubject(this.classId, subjectId);

    if (this.results.length === 0) {
      alert('No scanned results found for this subject.');
    }
    this.showAnalysis = false;
  }

  toggleAnalysis() {
    this.showAnalysis = !this.showAnalysis;
    if (this.showAnalysis) {
      this.loadAnalysis();
    }
  }

  deleteScan(resultId: number) {
    if (confirm('Are you sure you want to delete this scanned result?')) {
      const subject = LocalDataService.getSubject(this.classId, this.subjectId);
      if (subject?.results) {
        subject.results = subject.results.filter(r => r.id !== resultId);
        LocalDataService.save();
        this.goToScannedResults(this.subjectId);
      }
    }
  }

  viewScan(scan: ScannedResult) {
    this.router.navigate(['/resultviewer'], {
      state: { resultData: scan }
    });
  }

  viewResult(resultId: number, subjectId: number) {
    this.router.navigate(['/resultviewer'], {
      queryParams: {
        classId: this.classId,
        subjectId: subjectId,
        resultId: resultId
      }
    });
  }

  // 🔹 Load and compute analysis
  loadAnalysis() {
    this.results = LocalDataService.getResultsBySubject(this.classId, this.subjectId);
    if (this.results.length === 0) return;

    this.meanPercentage = LocalDataService.getMeanPercentage(this.classId, this.subjectId);
    this.computeDistribution();
    this.computeCompetencyBreakdown();
    this.aggregatedAnswerDist = LocalDataService.getAggregatedAnswerDistribution(this.classId, this.subjectId);
    this.aggregatedCognitive = LocalDataService.getAggregatedCognitiveBreakdown(this.classId, this.subjectId);

    // Ensure canvases exist before rendering
    setTimeout(() => {
      this.renderAggregatedAnswerChart();
      this.renderAggregatedCognitiveChart();
      this.renderScoreDistributionChart();
      this.renderCompetencyChart();
    }, 0);
  }

  // 🔹 Score distribution
  computeDistribution() {
    const ranges = [
      { range: '0-49', min: 0, max: 49 },
      { range: '50-69', min: 50, max: 69 },
      { range: '70-89', min: 70, max: 89 },
      { range: '90-100', min: 90, max: 100 },
    ];
    const counts = ranges.map(r => ({ range: r.range, count: 0 }));

    this.results.forEach(r => {
      const percent = (r.score / r.total) * 100;
      for (let i = 0; i < ranges.length; i++) {
        if (percent >= ranges[i].min && percent <= ranges[i].max) {
          counts[i].count++;
          break;
        }
      }
    });

    this.scoreDistribution = counts;
  }

  // 🔹 Competency breakdown
  computeCompetencyBreakdown() {
    this.competencyBreakdown = {};
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    if (!subject?.tos) return;
    const tosMap = LocalDataService.generateTOSMap(subject.tos);

    this.results.forEach(r => {
      r.answers.forEach(ans => {
        const mapEntry = tosMap.find(m => m.question === ans.question);
        if (mapEntry) {
          const key = `${mapEntry.topic} - ${mapEntry.competency}`;
          if (!this.competencyBreakdown[key]) {
            this.competencyBreakdown[key] = { correct: 0, total: 0 };
          }
          this.competencyBreakdown[key].total++;
          if (ans.correct) this.competencyBreakdown[key].correct++;
        }
      });
    });
  }

  renderAggregatedAnswerChart() {
    const ctx = document.getElementById('aggAnswersChart') as HTMLCanvasElement;
    if (!ctx) return;
    if (this.aggAnswersChart) this.aggAnswersChart.destroy();

    this.aggAnswersChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['A', 'B', 'C', 'D'],
        datasets: [
          {
            label: 'Total Selections',
            data: [
              this.aggregatedAnswerDist.A,
              this.aggregatedAnswerDist.B,
              this.aggregatedAnswerDist.C,
              this.aggregatedAnswerDist.D
            ],
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Aggregated Answer Distribution' } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  renderAggregatedCognitiveChart() {
    const ctx = document.getElementById('aggCognitiveChart') as HTMLCanvasElement;
    if (!ctx) return;
    if (this.aggCognitiveChart) this.aggCognitiveChart.destroy();

    const labels = Object.keys(this.aggregatedCognitive);
    const correct = labels.map(l => this.aggregatedCognitive[l].correct);
    const total = labels.map(l => this.aggregatedCognitive[l].total);

    this.aggCognitiveChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Correct', data: correct, backgroundColor: 'rgba(75, 192, 192, 0.7)' },
          { label: 'Total', data: total, backgroundColor: 'rgba(255, 99, 132, 0.3)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: "Aggregated Cognitive Breakdown" } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }
  renderScoreDistributionChart() {
  const ctx = document.getElementById('scoreChart') as HTMLCanvasElement;
  if (!ctx) return;
  if (this.scoreChart) this.scoreChart.destroy();

  const labels = this.scoreDistribution.map(d => d.range);
  const data = this.scoreDistribution.map(d => d.count);

  this.scoreChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Number of Students',
          data,
          backgroundColor: 'rgba(153, 102, 255, 0.7)',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: 'Score Distribution' } },
      scales: { 
  y: { 
    beginAtZero: true, 
    ticks: { precision: 0 }   // ✅ move precision here
  } 
},
    },
  });
}
renderCompetencyChart() {
  const ctx = document.getElementById('competencyChart') as HTMLCanvasElement;
  if (!ctx) return;
  if (this.competencyChart) this.competencyChart.destroy();

  const labels = Object.keys(this.competencyBreakdown);
  const correct = labels.map(l => this.competencyBreakdown[l].correct);
  const total = labels.map(l => this.competencyBreakdown[l].total);

  this.competencyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Correct',
          data: correct,
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
        },
        {
          label: 'Total',
          data: total,
          backgroundColor: 'rgba(255, 99, 132, 0.3)',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { 
        title: { display: true, text: 'Competency Breakdown' },
        legend: { position: 'top' }
      },
      scales: { 
        y: { beginAtZero: true, ticks: { precision: 0 } } 
      },
    },
  });
}

// Navigation Methods
goToDashboard() {
  this.menuController.close();
  this.navCtrl.navigateRoot('/teacher-dashboard');
}

goToClasses() {
  this.menuController.close();
  this.navCtrl.navigateRoot('/class-list');
}

goToScan() {
  this.menuController.close();
  this.navCtrl.navigateForward('/scan');
}

goToResults() {
  this.menuController.close();
  this.navCtrl.navigateForward('/resultviewer');
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
