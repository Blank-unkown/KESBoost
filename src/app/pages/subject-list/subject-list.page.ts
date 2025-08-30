import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { LocalDataService, Subject, ScannedResult } from '../../services/local-data.service';
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
  ) {}

  ngOnInit() {
    this.classId = Number(this.route.snapshot.paramMap.get('id'));
    const cls = LocalDataService.getClass(this.classId);
    this.subjects = cls?.subjects || [];
  }

  addSubject() {
    if (this.subjectName.trim()) {
      LocalDataService.addSubject(this.classId, this.subjectName);
      const cls = LocalDataService.getClass(this.classId);
      this.subjects = cls?.subjects || [];
      this.subjectName = '';
    }
  }

  deleteSubject(subjectId: number) {
    if (confirm('Are you sure you want to delete this subject?')) {
      LocalDataService.deleteSubject(this.classId, subjectId);
      const cls = LocalDataService.getClass(this.classId);
      this.subjects = cls?.subjects || [];
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

}
