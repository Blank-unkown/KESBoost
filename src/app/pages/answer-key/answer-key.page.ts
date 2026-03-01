import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule } from '@ionic/angular';
import { LocalDataService } from '../../services/local-data.service';
import { TeacherService } from '../../services/teacher.service';

@Component({
  selector: 'app-answer-key',
  templateUrl: './answer-key.page.html',
  styleUrls: ['./answer-key.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class AnswerKeyPage implements OnInit {
  classId!: number;
  subjectId!: number;
  totalQuestions = 0;
  answerKey: string[] = [];
  options = ['A', 'B', 'C', 'D'];
  isLockedToGenerated = false;
  lockReason = '';
  

  constructor(
    private route: ActivatedRoute,
    private alertController: AlertController,
    private teacherService: TeacherService
  ) {}

  private async presentAlert(message: string, header = '') {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private computeTotalQuestionsFromTos(tos: any[]): number {
    const cognitiveLevels = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating',
    ];
    return (Array.isArray(tos) ? tos : []).reduce((sum, row) => {
      return sum + cognitiveLevels.reduce((s, k) => s + Number((row as any)?.[k] || 0), 0);
    }, 0);
  }

  private normalizeAnswerLetter(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
  }

  async ngOnInit() {
    await LocalDataService.load();
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    let tos: any[] = Array.isArray(subject?.tos) ? (subject as any).tos : [];
    let questions: any[] = Array.isArray(subject?.questions) ? (subject as any).questions : [];
    const legacyAnswerKey: any[] = Array.isArray(subject?.answerKey) ? (subject as any).answerKey : [];

    // Load TOS and questions in parallel when both are needed.
    const needTos = !tos.length;
    const needQuestions = !questions.length;
    if (needTos || needQuestions) {
      const [tRes, qRes] = await Promise.all([
        needTos ? this.teacherService.loadSubjectTos(this.classId, this.subjectId) : Promise.resolve({ success: true, tos: [] }),
        needQuestions ? this.teacherService.loadSubjectQuestions(this.classId, this.subjectId) : Promise.resolve({ success: true, questions: [] })
      ]);
      if (needTos && tRes.success && Array.isArray(tRes.tos)) tos = tRes.tos;
      if (needQuestions && qRes.success && Array.isArray(qRes.questions)) questions = qRes.questions;
    }

    const totalFromTos = this.computeTotalQuestionsFromTos(tos);
    const totalFromQuestions = Array.isArray(questions) ? questions.length : 0;
    const totalFromAnswerKey = Array.isArray(legacyAnswerKey) ? legacyAnswerKey.length : 0;
    this.totalQuestions = totalFromTos > 0 ? totalFromTos : (totalFromQuestions > 0 ? totalFromQuestions : totalFromAnswerKey);

    const fromQuestions = Array.isArray(questions)
      ? questions.map((q: any) => this.normalizeAnswerLetter(q?.answer))
      : [];
    const fromLegacy = Array.isArray(legacyAnswerKey)
      ? legacyAnswerKey.map((a: any) => this.normalizeAnswerLetter(a))
      : [];

    const base = fromQuestions.some(Boolean) ? fromQuestions : fromLegacy;
    this.answerKey = new Array(this.totalQuestions).fill('').map((_, i) => base[i] || '');

    this.isLockedToGenerated = fromQuestions.some(Boolean);
    this.lockReason = this.isLockedToGenerated
      ? 'Answer key is linked to the generated questions. To change answers, edit them in Question Generator, then Save there.'
      : '';
  }


  setAnswer(index: number, option: string) {
    this.answerKey[index] = option;
  }

  trackByIndex(index: number, item: any): number {
  return index;
}


  saveAnswerKey() {
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    const normalized = (this.answerKey || []).map((a) => this.normalizeAnswerLetter(a));

    if (subject) {
      subject.answerKey = normalized;
      LocalDataService.save();
    }

    void this.teacherService.saveSubjectAnswerKey(this.classId, this.subjectId, normalized).then(async (res) => {
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to save answer key');
        return;
      }
      await this.presentAlert('Answer key saved!');
    });
  }
}
