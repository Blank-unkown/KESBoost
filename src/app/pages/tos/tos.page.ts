import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { AnswerSheetGeneratorPage } from '../answer-sheet-generator/answer-sheet-generator.page';
import { TeacherService } from '../../services/teacher.service';

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
  viewMode: 'edit' | 'print' | 'answersheet' = 'edit';

  tos: TopicEntry[] = [];
  totalItems = 0;
  isLoadingTos = false;
  isSavingTos = false;
getTotal(field: keyof TopicEntry): number {
  return this.tos.reduce((sum, topic) => sum + (Number(topic[field]) || 0), 0);
}

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService
  ) {}

  async ngOnInit() {
    await LocalDataService.load();
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    const cls = LocalDataService.getClass(this.classId);
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);

    this.className = cls?.name || '';
    this.subjectName = subject?.name || '';
    this.tos = subject?.tos || [];

    await this.loadTosFromFirebase();

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

  setMode(mode: 'edit' | 'print' | 'answersheet') {
    this.viewMode = mode;

    // Automatically trigger print when entering print mode
    if (mode === 'print') {
      setTimeout(() => {
        window.print();
      }, 300);
    }
  }

  onModeChange(mode: 'edit' | 'print' | 'answersheet') {
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
        alert(res.error || 'Failed to save TOS');
        return;
      }

      LocalDataService.saveTOS(this.classId, this.subjectId, payload);
      await LocalDataService.save();
      alert('TOS saved!');
    } catch (err: any) {
      alert(err?.message || 'Failed to save TOS');
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
