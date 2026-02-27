import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TeacherService, ClassStudent } from '../../services/teacher.service';
import { LocalDataService, ScannedResult } from '../../services/local-data.service';

@Component({
  selector: 'app-class-students',
  templateUrl: './class-students.page.html',
  styleUrls: ['./class-students.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ClassStudentsPage implements OnInit {
  classId!: number;
  subjectId!: number;
  subjectName = '';

  students: ClassStudent[] = [];
  classRoster: ClassStudent[] = [];
  classSubjects: { id: number; name: string }[] = [];
  availableRoster: ClassStudent[] = [];
  isLoading = false;
  isSaving = false;
  isEnrollSaving = false;
  isTransferSaving = false;

  showDeleteConfirm = false;
  deleteConfirmCount = 0;

  selectedRosterStudentIds = new Set<number>();
  transferTargetSubjectId: number | null = null;
  transferMode: 'copy' | 'move' = 'copy';

  selectedStudentIds = new Set<number>();

  studentsPage = 1;
  readonly studentsPageSize = 5;

  latestResultByStudentId = new Map<number, ScannedResult>();

  studentForm = {
    name: '',
    email: '',
    roll_number: ''
  };

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private teacherService: TeacherService,
    private toastController: ToastController
  ) {}

  async ngOnInit() {
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));
    this.subjectName = String(this.route.snapshot.queryParamMap.get('subjectName') || '');

    await LocalDataService.load();

    await Promise.all([
      this.loadStudents(),
      this.loadClassRoster(),
      this.loadClassSubjects()
    ]);

    this.recomputeAvailableRoster();
  }

  private refreshLatestResultsMap() {
    this.latestResultByStudentId.clear();
    for (const s of this.students || []) {
      const latest = LocalDataService.getLatestResultByStudent(this.classId, this.subjectId, s.id);
      if (latest) this.latestResultByStudentId.set(s.id, latest);
    }
  }

  async deleteSelectedFromClass() {
    const ids = Array.from(this.selectedStudentIds);
    if (ids.length === 0) {
      await this.showToast('Select at least one student', 'warning');
      return;
    }

    this.deleteConfirmCount = ids.length;
    this.showDeleteConfirm = true;
  }

  cancelDeleteConfirm() {
    this.showDeleteConfirm = false;
    this.deleteConfirmCount = 0;
  }

  async confirmDeleteFromClass() {
    const ids = Array.from(this.selectedStudentIds);
    if (ids.length === 0) {
      this.cancelDeleteConfirm();
      return;
    }

    this.isTransferSaving = true;
    try {
      for (const studentId of ids) {
        const result = await this.teacherService.deleteClassStudent(this.classId, studentId);
        if (!result.success) {
          await this.showToast(result.error || 'Failed to delete student', 'danger');
          return;
        }
      }

      await this.showToast('Student(s) deleted successfully!', 'success');
      this.selectedStudentIds.clear();
      await Promise.all([
        this.loadStudents(),
        this.loadClassRoster()
      ]);
      this.cancelDeleteConfirm();
    } catch (err) {
      console.error('Error deleting student(s):', err);
      await this.showToast('Error deleting students', 'danger');
    } finally {
      this.isTransferSaving = false;
    }
  }

  async loadStudents() {
    this.isLoading = true;
    try {
      this.students = await this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId);
    } catch (err) {
      await this.showToast('Failed to load students', 'danger');
      console.error('Failed to load students:', err);
    } finally {
      this.isLoading = false;
    }

    this.studentsPage = 1;
    this.recomputeAvailableRoster();
    this.refreshLatestResultsMap();
  }

  getLatestScoreLabel(studentId: number): string {
    const r = this.latestResultByStudentId.get(studentId);
    if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) <= 0) return '';
    const pct = (Number(r.score) / Number(r.total)) * 100;
    return `${r.score} / ${r.total} (${pct.toFixed(1)}%)`;
  }

  openLatestResult(student: ClassStudent, ev?: Event) {
    if (ev) ev.stopPropagation();
    const latest = this.latestResultByStudentId.get(student.id);
    if (!latest) {
      void this.showToast('No scan result found for this student yet.', 'warning');
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

  get totalStudentPages(): number {
    return Math.max(1, Math.ceil((this.students?.length || 0) / this.studentsPageSize));
  }

  get pagedStudents(): ClassStudent[] {
    const start = (this.studentsPage - 1) * this.studentsPageSize;
    return (this.students || []).slice(start, start + this.studentsPageSize);
  }

  prevStudentsPage() {
    this.studentsPage = Math.max(1, this.studentsPage - 1);
  }

  nextStudentsPage() {
    this.studentsPage = Math.min(this.totalStudentPages, this.studentsPage + 1);
  }

  async loadClassRoster() {
    try {
      this.classRoster = await this.teacherService.getClassStudents(this.classId);
    } catch (err) {
      console.error('Failed to load class roster:', err);
    }

    this.recomputeAvailableRoster();
  }

  private recomputeAvailableRoster() {
    const enrolledIds = new Set((this.students || []).map(s => s.id));
    this.availableRoster = (this.classRoster || []).filter(s => !enrolledIds.has(s.id));

    for (const id of Array.from(this.selectedRosterStudentIds)) {
      if (enrolledIds.has(id)) {
        this.selectedRosterStudentIds.delete(id);
      }
    }
  }

  async loadClassSubjects() {
    try {
      const subjects = await this.teacherService.getClassSubjects(this.classId);
      this.classSubjects = (subjects || []).map(s => ({ id: s.id, name: s.name }));
    } catch (err) {
      console.error('Failed to load class subjects:', err);
    }
  }

  async addStudent() {
    if (!this.studentForm.name || !this.studentForm.name.trim()) {
      await this.showToast('Please enter the student name', 'warning');
      return;
    }

    this.isSaving = true;
    try {
      const result = await this.teacherService.createClassStudent(this.classId, {
        name: this.studentForm.name.trim(),
        email: this.studentForm.email?.trim() || undefined,
        roll_number: this.studentForm.roll_number?.trim() || undefined
      });

      if (result.success) {
        if (result.student?.id) {
          await this.teacherService.enrollStudentToSubject(this.classId, this.subjectId, result.student.id);
        }
        await this.showToast('Student added and enrolled successfully!', 'success');
        this.studentForm = { name: '', email: '', roll_number: '' };
        await this.loadStudents();
      } else {
        await this.showToast(result.error || 'Failed to add student', 'danger');
      }
    } catch (err) {
      await this.showToast('Error adding student', 'danger');
      console.error('Error adding student:', err);
    } finally {
      this.isSaving = false;
    }
  }

  toggleRosterSelection(studentId: number, checked: boolean) {
    if (checked) {
      this.selectedRosterStudentIds.add(studentId);
    } else {
      this.selectedRosterStudentIds.delete(studentId);
    }
  }

  selectAllRoster() {
    for (const s of this.availableRoster) {
      this.selectedRosterStudentIds.add(s.id);
    }
  }

  clearRosterSelection() {
    this.selectedRosterStudentIds.clear();
  }

  async enrollSelectedStudents() {
    const ids = Array.from(this.selectedRosterStudentIds);
    if (ids.length === 0) {
      await this.showToast('Select at least one student to enroll', 'warning');
      return;
    }

    this.isEnrollSaving = true;
    try {
      for (const studentId of ids) {
        const result = await this.teacherService.enrollStudentToSubject(this.classId, this.subjectId, studentId);
        if (!result.success) {
          await this.showToast(result.error || 'Failed to enroll student', 'danger');
          return;
        }
      }

      await this.showToast('Student(s) enrolled successfully!', 'success');
      this.selectedRosterStudentIds.clear();
      await this.loadStudents();
    } catch (err) {
      console.error('Error enrolling student(s):', err);
      await this.showToast('Error enrolling students', 'danger');
    } finally {
      this.isEnrollSaving = false;
    }
  }

  async transferEnrollment() {
    if (!this.transferTargetSubjectId) {
      await this.showToast('Please select a target subject', 'warning');
      return;
    }

    if (Number(this.transferTargetSubjectId) === Number(this.subjectId)) {
      await this.showToast('Target subject must be different', 'warning');
      return;
    }

    this.isTransferSaving = true;
    try {
      const ids = Array.from(this.selectedStudentIds);
      if (ids.length === 0) {
        await this.showToast('Select at least one student', 'warning');
        return;
      }

      for (const studentId of ids) {
        const result = await this.teacherService.transferStudentEnrollment({
          classId: this.classId,
          source_subject_id: this.subjectId,
          student_id: studentId,
          target_subject_id: this.transferTargetSubjectId,
          mode: this.transferMode
        });

        if (!result.success) {
          await this.showToast(result.error || 'Failed to transfer enrollment', 'danger');
          return;
        }
      }

      await this.showToast(`Enrollment ${this.transferMode}d successfully!`, 'success');
      this.transferTargetSubjectId = null;
      this.transferMode = 'copy';
      this.selectedStudentIds.clear();
      await this.loadStudents();
    } catch (err) {
      console.error('Error transferring enrollment:', err);
      await this.showToast('Error transferring enrollment', 'danger');
    } finally {
      this.isTransferSaving = false;
    }
  }

  toggleStudentSelection(studentId: number, checked: boolean) {
    if (checked) {
      this.selectedStudentIds.add(studentId);
    } else {
      this.selectedStudentIds.delete(studentId);
    }
  }

  clearSelection() {
    this.selectedStudentIds.clear();
  }

  selectAllEnrolledOnPage() {
    for (const s of this.pagedStudents) {
      this.selectedStudentIds.add(s.id);
    }
  }

  selectAllEnrolled() {
    for (const s of this.students) {
      this.selectedStudentIds.add(s.id);
    }
  }

  async unenrollSelected() {
    const ids = Array.from(this.selectedStudentIds);
    if (ids.length === 0) {
      await this.showToast('Select at least one student', 'warning');
      return;
    }

    this.isTransferSaving = true;
    try {
      for (const studentId of ids) {
        const result = await this.teacherService.unenrollStudentFromSubject(this.classId, this.subjectId, studentId);
        if (!result.success) {
          await this.showToast(result.error || 'Failed to unenroll student', 'danger');
          return;
        }
      }

      await this.showToast('Student(s) unenrolled successfully!', 'success');
      this.selectedStudentIds.clear();
      await this.loadStudents();
    } catch (err) {
      console.error('Error unenrolling student:', err);
      await this.showToast('Error unenrolling student', 'danger');
    } finally {
      this.isTransferSaving = false;
    }
  }

  goBack() {
    this.navCtrl.back();
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
