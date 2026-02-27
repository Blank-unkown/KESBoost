import { Component, OnInit, Input } from '@angular/core';
import { NavController, ToastController, LoadingController, IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { ActivatedRoute } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { TeacherService, ClassStudent } from '../../services/teacher.service';
import { bubbles, BubbleTemplate } from '../../data/bubble-template';

@Component({
  selector: 'app-answer-sheet-generator',
  templateUrl: './answer-sheet-generator.page.html',
  styleUrls: ['./answer-sheet-generator.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AnswerSheetGeneratorPage implements OnInit {

  @Input() classId!: number;
  @Input() subjectId!: number;
  @Input() embedded: boolean = false;

  tos: TopicEntry[] = [];
  questions: any[] = [];
  totalQuestions = 0;
  className = '';
  subjectName = '';
  pdfContent: string | null = null;

  students: ClassStudent[] = [];
  selectedStudentId: number | 'all' = 'all';
  currentStudentName: string = '';
  currentStudentRollNumber: string = '';

  constructor(
    private route: ActivatedRoute,
    private toastController: ToastController,
    private loadingController: LoadingController,
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

  private async presentConfirm(message: string, header = ''): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });
    await alert.present();
    const res = await alert.onDidDismiss();
    return res.role === 'confirm';
  }

  private computeTotalQuestionsFromTos(tos: TopicEntry[]): number {
    const cognitiveLevels: (keyof TopicEntry)[] = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating',
    ];
    return (tos || []).reduce((sum, row) => {
      return (
        sum +
        cognitiveLevels.reduce((s, level) => s + Number((row as any)?.[level] || 0), 0)
      );
    }, 0);
  }

  private async resolveClassAndSubjectNames() {
    // Prefer local cache first
    const cls = LocalDataService.getClass(this.classId);
    if (cls?.name) this.className = String(cls.name);

    const localSubject = LocalDataService.getSubject(this.classId, this.subjectId);
    if (localSubject?.name) this.subjectName = String(localSubject.name);

    // If names are missing (fresh install / not cached), pull from Firebase lists
    try {
      if (!this.className) {
        const classes = await this.teacherService.getClasses();
        const c = (classes || []).find((k: any) => Number(k?.id) === Number(this.classId));
        if (c?.name) this.className = String(c.name);
      }
    } catch (e) {
      console.error('resolveClassAndSubjectNames: failed to load classes', e);
    }

    try {
      if (!this.subjectName) {
        const subjects = await this.teacherService.getClassSubjects(this.classId);
        const s = (subjects || []).find((k: any) => Number(k?.id) === Number(this.subjectId));
        if (s?.name) this.subjectName = String(s.name);
      }
    } catch (e) {
      console.error('resolveClassAndSubjectNames: failed to load subjects', e);
    }
  }

  async ngOnInit() {

    await LocalDataService.load();

    // This component is used in two ways:
    // 1) Embedded inside TOS page via @Input() classId/subjectId
    // 2) Standalone route /answer-sheet-generator/:classId/:subjectId
    // Only use route params if Inputs aren't provided.
    if (!Number.isFinite(Number(this.classId)) || Number(this.classId) <= 0) {
      this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    }
    if (!Number.isFinite(Number(this.subjectId)) || Number(this.subjectId) <= 0) {
      this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));
    }

    if (!Number.isFinite(this.classId) || !Number.isFinite(this.subjectId)) {
      await this.presentAlert('Missing class/subject. Please open this from your Class and Subject list.');
      return;
    }

    await this.resolveClassAndSubjectNames();

    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    this.tos = subject?.tos || [];

    try {
      this.students = await this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId);
    } catch (e) {
      console.error(e);
      this.students = [];
    }

    this.selectedStudentId = 'all';
    this.applySelectedStudent();

    // Prefer saved questions (from Question Generator) for export layout.
    this.questions = Array.isArray(subject?.questions) ? (subject?.questions as any[]) : [];
    if (!this.questions.length) {
      try {
        const qRes = await this.teacherService.loadSubjectQuestions(this.classId, this.subjectId);
        if (qRes.success && Array.isArray(qRes.questions)) {
          this.questions = qRes.questions;
          if (subject) {
            subject.questions = this.questions;
            await LocalDataService.save();
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    const tosTotal = this.computeTotalQuestionsFromTos(this.tos);
    const qTotal = Array.isArray(this.questions) ? this.questions.length : 0;
    this.totalQuestions = qTotal > 0 ? qTotal : tosTotal;

    if (this.totalQuestions > bubbles.length) {
      await this.presentAlert(
        `This answer sheet template supports up to ${bubbles.length} questions. Your current total is ${this.totalQuestions}. Please reduce the total questions in TOS/Question Generator or expand the template.`,
        'Too many questions'
      );
      this.totalQuestions = bubbles.length;
    }
  }

  applySelectedStudent() {
    if (this.selectedStudentId === 'all') {
      this.currentStudentName = '';
      this.currentStudentRollNumber = '';
      return;
    }

    const idNum = Number(this.selectedStudentId);
    const st = (this.students || []).find(s => Number(s.id) === idNum);
    this.currentStudentName = st ? String(st.name || '') : '';
    this.currentStudentRollNumber = st ? String(st.roll_number || '') : '';
  }

  get selectedStudentLabel(): string {
    if (this.selectedStudentId === 'all') return 'All Students';
    const idNum = Number(this.selectedStudentId);
    const st = (this.students || []).find(s => Number(s.id) === idNum);
    if (!st) return 'Selected Student';
    const roll = st.roll_number ? ` (${st.roll_number})` : '';
    return `${st.name}${roll}`;
  }

  get displayQuestions(): any[] {
    const list = Array.isArray(this.questions) ? this.questions : [];
    if (list.length) return list;
    // fallback: generate blank placeholders if questions aren't available
    return new Array(this.totalQuestions).fill(null).map(() => ({
      question: '',
      choices: { A: '', B: '', C: '', D: '' },
    }));
  }

  get exportBubbles(): BubbleTemplate[] {
    const max = Math.min(Number(this.totalQuestions || 0), bubbles.length);
    return bubbles.filter((b) => b.question <= max);
  }

  private svgElementToCanvas(
    svgEl: SVGElement,
    width: number,
    height: number,
    scale: number
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      try {
        const xml = new XMLSerializer().serializeToString(svgEl);
        const svg = xml.includes('xmlns=') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context missing');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.drawImage(img, 0, 0, width, height);

            URL.revokeObjectURL(url);
            resolve(canvas);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      } catch (e) {
        reject(e);
      }
    });
  }

  private async buildPdfFromSvgForStudents(svgEl: SVGElement, studentsToExport: ClassStudent[]) {
    const isWeb = Capacitor.getPlatform() === 'web';
    const scale = isWeb ? 2 : 1.25;

    const svgWidth = 800;
    const svgHeight = 1131;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    for (let i = 0; i < studentsToExport.length; i++) {
      const st = studentsToExport[i];
      this.currentStudentName = String(st?.name || '');
      this.currentStudentRollNumber = String(st?.roll_number || '');

      // Let Angular update the SVG bindings
      await new Promise((r) => setTimeout(r, 30));

      const canvas = await this.svgElementToCanvas(svgEl, svgWidth, svgHeight, scale);
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      const imgProps = pdf.getImageProperties(imgData);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
      const renderWidth = imgProps.width * ratio;
      const renderHeight = imgProps.height * ratio;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, renderWidth, renderHeight);
    }

    return pdf;
  }

  async exportPDF() {

    const element = document.getElementById('export-bubble-sheet') as SVGElement | null;
    if (!element) {
      await this.presentAlert('Answer sheet not found.');
      return;
    }

    const roster = Array.isArray(this.students) ? this.students : [];
    const studentsToExport: ClassStudent[] =
      this.selectedStudentId === 'all'
        ? roster
        : roster.filter(s => Number(s.id) === Number(this.selectedStudentId));

    if (!studentsToExport.length) {
      await this.presentAlert('No enrolled students found for this subject. Please enroll students first in Class Students.');
      return;
    }

    if (this.selectedStudentId === 'all' && studentsToExport.length > 1) {
      const ok = await this.presentConfirm(
        `This will generate ${studentsToExport.length} page(s) (one per student). Continue?`,
        'Export All Students'
      );
      if (!ok) return;
    }

    const loading = await this.loadingController.create({
      message: 'Generating PDF...',
      spinner: 'dots',
    });
    await loading.present();

    try {
      const pdf = await this.buildPdfFromSvgForStudents(element, studentsToExport);
      const fileName = `answer-sheet-${this.className}-${this.subjectName}-${Date.now()}.pdf`;

      const isWeb = Capacitor.getPlatform() === 'web';
      if (!isWeb) {
        const pdfBase64 = pdf.output('datauristring').split(',')[1];
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Documents,
          });

          await this.showToast('✅ PDF saved!');

          let shareUrl = '';
          if (Capacitor.getPlatform() === 'android') {
            const fileUri = await Filesystem.getUri({
              path: fileName,
              directory: Directory.Documents,
            });
            shareUrl = fileUri.uri;
          } else if (Capacitor.getPlatform() === 'ios') {
            shareUrl = `data:application/pdf;base64,${pdfBase64}`;
          }

          await Share.share({
            title: 'Generated Answer Sheet',
            text: 'Here is the generated answer sheet.',
            url: shareUrl,
            dialogTitle: 'Share PDF',
          });

          await this.showToast('✅ PDF shared!');
        } catch (err) {
          console.error('PDF save/share failed:', err);
          const msg = String((err as any)?.message || err);
          await this.presentAlert('PDF export/share failed: ' + msg);
        }
      } else {
        const blobUrl = pdf.output('bloburl').toString();
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.open(blobUrl, '_blank');
        await this.showToast('✅ PDF downloaded and opened!');
      }
    } catch (error) {
      console.error('Export error:', error);
      const msg = String((error as any)?.message || error);
      await this.presentAlert('Failed to export or share PDF: ' + msg);
    } finally {
      this.applySelectedStudent();
      await loading.dismiss();
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color: 'dark',
    });
    await toast.present();
  }
}