import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AlertController } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LocalDataService, ScannedResult, TopicEntry } from '../../services/local-data.service';
import { AnswerSheetGeneratorPage } from '../answer-sheet-generator/answer-sheet-generator.page';
import { ClassStudent, TeacherService } from '../../services/teacher.service';

@Component({
  selector: 'app-tos',
  templateUrl: './tos.page.html',
  styleUrls: ['./tos.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AnswerSheetGeneratorPage, RouterModule] 
})
export class TosPage implements OnInit {
  classId!: number;
  subjectId!: number;
  className = '';
  subjectName = '';
  viewMode: 'edit' | 'print' | 'answersheet' | 'students' = 'edit';

  tos: TopicEntry[] = [];
  totalItems = 0;
  isLoadingTos = false;
  isSavingTos = false;

  students: ClassStudent[] = [];
  isLoadingStudents = false;
  selectedStudentId: number | null = null;
  studentSummaryById = new Map<number, { attempts: number; avgPct: number; latest?: ScannedResult }>();

  topicJumpIndex: number | null = null;
  private expandedTopicIndexes = new Set<number>();
getTotal(field: keyof TopicEntry): number {
  return this.tos.reduce((sum, topic) => sum + (Number(topic[field]) || 0), 0);
}

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService,
    private navCtrl: NavController,
    private alertController: AlertController
  ) {}

  private async presentAlert(message: string, header = '') {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private recomputeStudentSummaries() {
    this.studentSummaryById.clear();
    for (const s of this.students || []) {
      const results = LocalDataService.getResultsByStudent(this.classId, this.subjectId, s.id);
      const attempts = results.length;
      const avgPct = attempts
        ? results.reduce((sum, r) => sum + ((Number(r.total) > 0) ? (Number(r.score) / Number(r.total)) * 100 : 0), 0) / attempts
        : 0;
      const latest = LocalDataService.getLatestResultByStudent(this.classId, this.subjectId, s.id);
      this.studentSummaryById.set(s.id, { attempts, avgPct, latest: latest || undefined });
    }
  }

  async loadStudents() {
    this.isLoadingStudents = true;
    try {
      this.students = await this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId);
      this.recomputeStudentSummaries();
      if (this.students.length && !this.selectedStudentId) {
        this.selectedStudentId = this.students[0].id;
      }
    } catch (e) {
      console.error('Failed to load students for TOS page', e);
      this.students = [];
      this.studentSummaryById.clear();
    } finally {
      this.isLoadingStudents = false;
    }
  }

  selectStudent(studentId: number) {
    this.selectedStudentId = studentId;
  }

  getSelectedStudent(): ClassStudent | undefined {
    if (!this.selectedStudentId) return undefined;
    return (this.students || []).find(s => Number(s.id) === Number(this.selectedStudentId));
  }

  getSelectedStudentSummary(): { attempts: number; avgPct: number; latest?: ScannedResult } | undefined {
    if (!this.selectedStudentId) return undefined;
    return this.studentSummaryById.get(this.selectedStudentId);
  }

  getStudentLatestLabel(studentId: number): string {
    const s = this.studentSummaryById.get(studentId);
    const r = s?.latest;
    if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) <= 0) return '';
    const pct = (Number(r.score) / Number(r.total)) * 100;
    return `${r.score} / ${r.total} (${pct.toFixed(1)}%)`;
  }

  openSelectedStudentLatestResult() {
    const summary = this.getSelectedStudentSummary();
    const latest = summary?.latest;
    if (!latest) {
      void this.presentAlert('No scan result found for this student yet.');
      return;
    }
    this.navCtrl.navigateForward('/resultviewer', {
      queryParams: {
        classId: this.classId,
        subjectId: this.subjectId,
        resultId: latest.id
      }
    });
  }

  isTopicExpanded(index: number): boolean {
    return this.expandedTopicIndexes.has(index);
  }

  toggleTopic(index: number) {
    if (this.expandedTopicIndexes.has(index)) this.expandedTopicIndexes.delete(index);
    else this.expandedTopicIndexes.add(index);
  }

  expandAllTopics() {
    this.expandedTopicIndexes = new Set(this.tos.map((_, i) => i));
  }

  collapseAllTopics() {
    this.expandedTopicIndexes.clear();
  }

  async deleteTopic(index: number) {
    if (!Number.isFinite(index) || index < 0 || index >= (this.tos?.length || 0)) return;

    const alert = await this.alertController.create({
      header: 'Delete Topic? ',
      message: 'This will remove the topic from the TOS. You can Save TOS to apply the change permanently.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.tos.splice(index, 1);

            // Rebuild expanded indexes based on removed item
            const next = new Set<number>();
            for (const i of Array.from(this.expandedTopicIndexes)) {
              if (i === index) continue;
              next.add(i > index ? i - 1 : i);
            }
            this.expandedTopicIndexes = next;

            if (this.topicJumpIndex !== null && this.topicJumpIndex !== undefined) {
              if (this.topicJumpIndex === index) this.topicJumpIndex = null;
              else if (this.topicJumpIndex > index) this.topicJumpIndex = this.topicJumpIndex - 1;
            }

            this.recomputeTotals();
            this.totalItems = this.totalTosItems;
          }
        }
      ]
    });
    await alert.present();
  }

  jumpToTopic(index: number | null) {
    if (index === null || index === undefined) return;
    const el = document.getElementById(`tos-topic-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async ngOnInit() {
    await LocalDataService.load();
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    const cls = LocalDataService.getClass(this.classId);
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);

    this.className = cls?.name || '';
    this.subjectName = subject?.name || '';
    this.tos = subject?.tos || [];

    // Default: expand first topic (if any)
    if (this.tos.length) this.expandedTopicIndexes.add(0);

    await this.loadTosFromFirebase();

    await this.loadStudents();

    this.totalItems = this.tos.reduce((sum, row) => {
      return (
        sum +
        (row.remembering || 0) +
        (row.understanding || 0) +
        (row.applying || 0) +
        (row.analyzing || 0) +
        (row.evaluating || 0) +
        (row.creating || 0)
      );
    }, 0);
  }

  private recomputeTotals() {
    this.totalItems = this.tos.reduce((sum, row) => {
      return (
        sum +
        (row.remembering || 0) +
        (row.understanding || 0) +
        (row.applying || 0) +
        (row.analyzing || 0) +
        (row.evaluating || 0) +
        (row.creating || 0)
      );
    }, 0);
  }

  private async loadTosFromFirebase() {
    this.isLoadingTos = true;
    try {
      const res = await this.teacherService.loadSubjectTos(this.classId, this.subjectId);
      if (res.success) {
        this.tos = res.tos || [];
        LocalDataService.saveTOS(this.classId, this.subjectId, this.tos);
        await LocalDataService.save();
        this.recomputeTotals();
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.isLoadingTos = false;
    }
  }

  setMode(mode: 'edit' | 'print' | 'answersheet' | 'students') {
    this.viewMode = mode;

    // Automatically trigger print when entering print mode
    if (mode === 'print') {
      setTimeout(() => {
        window.print();
      }, 300);
    }
  }

  onModeChange(mode: 'edit' | 'print' | 'answersheet' | 'students') {
    this.setMode(mode);
  }
  addTopicRow() {
  this.tos.push({
    topicName: '',
    learningCompetency: '',
    days: 0,
    percent: 0,
    expectedItems: 0,
    remembering: 0,
    understanding: 0,
    applying: 0,
    analyzing: 0,
    evaluating: 0,
    creating: 0
  });

  const idx = this.tos.length - 1;
  this.expandedTopicIndexes.add(idx);
  this.topicJumpIndex = idx;
  setTimeout(() => this.jumpToTopic(idx), 50);
  }

  async saveTos() {
    if (this.isSavingTos) return;
    this.isSavingTos = true;
    try {
      const payload = (this.tos || []).map((row) => ({
        topicName: String(row.topicName || ''),
        learningCompetency: String(row.learningCompetency || ''),
        days: Number(row.days || 0),
        percent: Number(row.percent || 0),
        expectedItems: Number(row.expectedItems || 0),
        remembering: Number(row.remembering || 0),
        understanding: Number(row.understanding || 0),
        applying: Number(row.applying || 0),
        analyzing: Number(row.analyzing || 0),
        evaluating: Number(row.evaluating || 0),
        creating: Number(row.creating || 0),
      }));

      const res = await this.teacherService.saveSubjectTos(this.classId, this.subjectId, payload);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to save TOS');
        return;
      }

      LocalDataService.saveTOS(this.classId, this.subjectId, payload);
      await LocalDataService.save();
      await this.presentAlert('TOS saved!');
    } catch (err: any) {
      await this.presentAlert(err?.message || 'Failed to save TOS');
    } finally {
      this.isSavingTos = false;
    }
  }

  get totalTosItems(): number {
    return (
      Number(this.getTotal('remembering')) +
      Number(this.getTotal('understanding')) +
      Number(this.getTotal('applying')) +
      Number(this.getTotal('analyzing')) +
      Number(this.getTotal('evaluating')) +
      Number(this.getTotal('creating'))
    );
  }

}
