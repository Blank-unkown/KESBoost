import { Injectable } from '@angular/core';

import { HttpClient, HttpHeaders } from '@angular/common/http';

import { Observable, BehaviorSubject } from 'rxjs';

import { Preferences } from '@capacitor/preferences';

import { environment } from 'src/environments/environment';

import { collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { firebaseDb } from '../firebase';
import type { TopicEntry } from './local-data.service';



export interface Subject {

  id: number;

  name: string;

  code?: string;

  description?: string | null;

  total_marks?: number;

  student_count?: number;

  class_id?: number;

  teacher_id?: number;

}



export interface ClassData {

  id: number;

  name: string;

  grade_level?: string;

  student_count: number;

  subjects?: Subject[];

}



export interface ClassStudent {

  id: number;

  name: string;

  email?: string | null;

  roll_number?: string | null;

  enrollment_date?: string;

}



@Injectable({

  providedIn: 'root'

})

export class TeacherService {

  private apiUrl = `${environment.apiBaseUrl}/teacher`;

  private classesSubject = new BehaviorSubject<ClassData[]>([]);

  public classes$ = this.classesSubject.asObservable();



  constructor(private http: HttpClient) {}



  private async getTeacherId(): Promise<string> {
    const userData = await Preferences.get({ key: 'currentUser' });
    const user = JSON.parse(userData.value || '{}');
    const teacherId = String(user?.id || '').trim();
    if (!teacherId) {
      throw new Error('Not logged in');
    }
    return teacherId;
  }

  async loadSubjectQuestions(
    classId: number,
    subjectId: number
  ): Promise<{ success: boolean; questions: any[]; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const snap = await getDoc(subjectRef);
      if (!snap.exists()) {
        return { success: true, questions: [] };
      }

      const data: any = snap.data();
      const questions: any[] = Array.isArray(data?.questions) ? data.questions : [];
      return { success: true, questions };
    } catch (err: any) {
      console.error('Error loading questions:', err);
      return { success: false, questions: [], error: err.message || 'Failed to load questions' };
    }
  }

  async saveSubjectQuestions(
    classId: number,
    subjectId: number,
    questions: any[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await setDoc(
        subjectRef,
        {
          questions: Array.isArray(questions) ? questions : [],
          questionsUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return { success: true };
    } catch (err: any) {
      console.error('Error saving questions:', err);
      return { success: false, error: err.message || 'Failed to save questions' };
    }
  }

  async loadSubjectTos(classId: number, subjectId: number): Promise<{ success: boolean; tos: TopicEntry[]; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const snap = await getDoc(subjectRef);
      if (!snap.exists()) {
        return { success: true, tos: [] };
      }

      const data: any = snap.data();
      const tos: TopicEntry[] = Array.isArray(data?.tos) ? data.tos : [];
      return { success: true, tos };
    } catch (err: any) {
      console.error('Error loading TOS:', err);
      return { success: false, tos: [], error: err.message || 'Failed to load TOS' };
    }
  }

  async saveSubjectTos(
    classId: number,
    subjectId: number,
    tos: TopicEntry[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await setDoc(
        subjectRef,
        {
          tos,
          tosUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return { success: true };
    } catch (err: any) {
      console.error('Error saving TOS:', err);
      return { success: false, error: err.message || 'Failed to save TOS' };
    }
  }




  async getClassStudents(classId: number): Promise<ClassStudent[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes', String(classId), 'students'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          email: data.email ?? null,
          roll_number: data.roll_number ?? null,
          enrollment_date: data.enrollment_date ? String(data.enrollment_date) : undefined
        };
      });
    } catch (err) {
      console.error('Error fetching class students:', err);
      return [];
    }
  }



  async createClassStudent(
    classId: number,
    payload: { name: string; email?: string; roll_number?: string }
  ): Promise<{ success: boolean; student?: ClassStudent; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const id = Date.now();

      const student: ClassStudent = {
        id,
        name: payload.name,
        email: payload.email ?? null,
        roll_number: payload.roll_number ?? null,
        enrollment_date: new Date().toISOString()
      };

      await setDoc(doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(id)), {
        ...student,
        createdAt: Date.now()
      });

      const classRef = doc(db, 'teachers', teacherId, 'classes', String(classId));
      await updateDoc(classRef, { student_count: increment(1) });

      return { success: true, student };
    } catch (err: any) {
      console.error('Error creating class student:', err);
      return { success: false, error: err.message || 'Failed to create student' };
    }
  }



  private async getAuthHeaders(): Promise<HttpHeaders> {

    const token = await Preferences.get({ key: 'authToken' });

    return new HttpHeaders({

      'Authorization': `Bearer ${token.value || ''}`,

      'Content-Type': 'application/json'

    });

  }



  /**

   * Delete a student from a class roster

   */

  async deleteClassStudent(

    classId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const rosterRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(studentId));
      const rosterSnap = await getDoc(rosterRef);
      if (!rosterSnap.exists()) {
        return { success: true };
      }

      await deleteDoc(rosterRef);

      const classRef = doc(db, 'teachers', teacherId, 'classes', String(classId));
      await updateDoc(classRef, { student_count: increment(-1) });
      return { success: true };

    } catch (err: any) {

      console.error('Error deleting class student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to delete student' };

    }

  }



  /**

   * Unenroll student from a subject (keeps them in class roster)

   */

  async unenrollStudentFromSubject(

    classId: number,

    subjectId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const enrollmentRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'enrollments',
        String(studentId)
      );

      const enrollmentSnap = await getDoc(enrollmentRef);
      if (!enrollmentSnap.exists()) {
        return { success: true };
      }

      await deleteDoc(enrollmentRef);

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await updateDoc(subjectRef, { student_count: increment(-1) });

      return { success: true };

    } catch (err: any) {

      console.error('Error unenrolling student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to unenroll student' };

    }

  }



  /**

   * Get students enrolled in a subject

   */

  async getSubjectStudents(subjectId: number): Promise<ClassStudent[]> {

    return this.getSubjectStudentsForClass(0, subjectId);

  }



  async getSubjectStudentsForClass(classId: number, subjectId: number): Promise<ClassStudent[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(subjectId),
          'enrollments'
        ),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          email: data.email ?? null,
          roll_number: data.roll_number ?? null,
          enrollment_date: data.enrollment_date ? String(data.enrollment_date) : undefined
        };
      });
    } catch (err) {
      console.error('Error fetching subject students:', err);
      return [];
    }
  }



  /**

   * Enroll an existing class student into a subject

   */

  async enrollStudentToSubject(

    classId: number,

    subjectId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const enrollmentRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'enrollments',
        String(studentId)
      );

      const existingEnrollment = await getDoc(enrollmentRef);
      if (existingEnrollment.exists()) {
        return { success: true };
      }

      const rosterDoc = await getDoc(
        doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(studentId))
      );
      if (!rosterDoc.exists()) {
        return { success: false, error: 'Student not found in class roster' };
      }

      const roster: any = rosterDoc.data();

      await setDoc(
        enrollmentRef,
        {
          id: Number(roster.id || studentId),
          name: roster.name || '',
          email: roster.email ?? null,
          roll_number: roster.roll_number ?? null,
          enrollment_date: new Date().toISOString(),
          createdAt: Date.now()
        },
        { merge: true }
      );

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await updateDoc(subjectRef, { student_count: increment(1) });

      return { success: true };

    } catch (err: any) {

      console.error('Error enrolling student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to enroll student' };

    }

  }



  /**

   * Copy/Move student enrollment between subjects

   */

  async transferStudentEnrollment(payload: {

    classId: number;

    source_subject_id: number;

    student_id: number;

    target_subject_id: number;

    mode: 'copy' | 'move';

  }): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const studentId = payload.student_id;
      const classId = payload.classId;

      const sourceRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(payload.source_subject_id),
        'enrollments',
        String(studentId)
      );

      const targetRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(payload.target_subject_id),
        'enrollments',
        String(studentId)
      );

      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) {
        return { success: false, error: 'Source enrollment not found' };
      }

      const targetAlreadyExists = (await getDoc(targetRef)).exists();

      await setDoc(targetRef, { ...sourceSnap.data(), createdAt: Date.now() }, { merge: true });

      if (!targetAlreadyExists) {
        const targetSubjectRef = doc(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(payload.target_subject_id)
        );
        await updateDoc(targetSubjectRef, { student_count: increment(1) });
      }

      if (payload.mode === 'move') {
        await deleteDoc(sourceRef);

        const sourceSubjectRef = doc(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(payload.source_subject_id)
        );
        await updateDoc(sourceSubjectRef, { student_count: increment(-1) });
      }

      return { success: true };

    } catch (err: any) {

      console.error('Error transferring enrollment:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to transfer enrollment' };

    }

  }



  async getClasses(): Promise<ClassData[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      const baseClasses: ClassData[] = snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          grade_level: data.grade_level ? String(data.grade_level) : undefined,
          student_count: data.student_count !== undefined ? Number(data.student_count) : 0
        };
      });

      const hydratedBase = await Promise.all(
        baseClasses.map(async (cls) => {
          try {
            const rosterSnap = await getDocs(
              collection(db, 'teachers', teacherId, 'classes', String(cls.id), 'students')
            );
            const count = rosterSnap.size;

            if (count === Number(cls.student_count || 0)) {
              return cls;
            }

            const classRef = doc(db, 'teachers', teacherId, 'classes', String(cls.id));
            await updateDoc(classRef, { student_count: count });
            return { ...cls, student_count: count };
          } catch {
            return cls;
          }
        })
      );

      const classesWithSubjects = await Promise.all(
        hydratedBase.map(async (cls) => {
          const subjects = await this.getClassSubjects(cls.id);
          return { ...cls, subjects };
        })
      );

      this.classesSubject.next(classesWithSubjects);
      return classesWithSubjects;
    } catch (err) {
      console.error('Error fetching classes:', err);
      return [];
    }
  }



  async getClassSubjects(classId: number): Promise<Subject[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes', String(classId), 'subjects'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);

      const subjects = snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          code: data.code ? String(data.code) : undefined,
          description: data.description ?? null,
          total_marks: data.total_marks !== undefined ? Number(data.total_marks) : undefined,
          student_count: data.student_count !== undefined ? Number(data.student_count) : undefined,
          class_id: Number(classId)
        } as Subject;
      });

      const hydrated = await Promise.all(
        subjects.map(async (sub) => {
          if (typeof sub.student_count === 'number') return sub;

          try {
            const enrollSnap = await getDocs(
              collection(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(sub.id), 'enrollments')
            );
            const count = enrollSnap.size;
            const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(sub.id));
            await updateDoc(subjectRef, { student_count: count });
            return { ...sub, student_count: count };
          } catch {
            return { ...sub, student_count: 0 };
          }
        })
      );

      return hydrated;
    } catch (err) {
      console.error('Error fetching class subjects:', err);
      return [];
    }
  }



  async createClass(
    className: string,
    gradLevel?: string
  ): Promise<{ success: boolean; class?: ClassData; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const id = Date.now();
      const newClass: ClassData = {
        id,
        name: className,
        grade_level: gradLevel || undefined,
        student_count: 0,
        subjects: []
      };

      await setDoc(doc(db, 'teachers', teacherId, 'classes', String(id)), {
        id,
        name: className,
        grade_level: gradLevel || '',
        student_count: 0,
        createdAt: Date.now()
      });

      await this.getClasses();
      return { success: true, class: newClass };
    } catch (err: any) {
      console.error('Error creating class:', err);
      return { success: false, error: err.message || 'Failed to create class' };
    }
  }



  async deleteClass(classId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      await deleteDoc(doc(db, 'teachers', teacherId, 'classes', String(classId)));
      await this.getClasses();
      return { success: true };
    } catch (err: any) {
      console.error('Error deleting class:', err);
      return { success: false, error: err.message || 'Failed to delete class' };
    }
  }



  async createSubject(payload: {
    name: string;
    code?: string;
    class_id: number;
    description?: string;
    total_marks?: number;
  }): Promise<{ success: boolean; subject?: Subject; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const id = Date.now();

      const subject: Subject = {
        id,
        name: payload.name,
        code: payload.code,
        description: payload.description ?? null,
        total_marks: payload.total_marks,
        class_id: payload.class_id
      };

      await setDoc(
        doc(db, 'teachers', teacherId, 'classes', String(payload.class_id), 'subjects', String(id)),
        {
          id,
          name: payload.name,
          code: payload.code || '',
          description: payload.description || '',
          total_marks: payload.total_marks ?? null,
          class_id: payload.class_id,
          student_count: 0,
          createdAt: Date.now()
        }
      );

      return { success: true, subject };
    } catch (err: any) {
      console.error('Error creating subject:', err);
      return { success: false, error: err.message || 'Failed to create subject' };
    }
  }



  async deleteSubject(classId: number, subjectId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      await deleteDoc(doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId)));
      return { success: true };
    } catch (err: any) {
      console.error('Error deleting subject:', err);
      return { success: false, error: err.message || 'Failed to delete subject' };
    }
  }



  /**

   * Update teacher profile information

   */

  async updateProfile(profileData: any): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const payload: any = {
        name: profileData?.name ?? '',
        email: profileData?.email ?? '',
        schoolId: profileData?.schoolId ?? '',
        bio: profileData?.bio ?? ''
      };

      await setDoc(doc(db, 'users', teacherId), {
        ...payload,
        updatedAt: Date.now()
      }, { merge: true });

      return { success: true };

    } catch (err: any) {

      console.error('Error updating profile:', err);

      return { success: false, error: err.message || 'Failed to update profile' };

    }

  }



  async getMyProfile(): Promise<{ success: boolean; profile?: any; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const snap = await getDoc(doc(db, 'users', teacherId));
      if (!snap.exists()) {
        return { success: true, profile: null };
      }

      return { success: true, profile: snap.data() };
    } catch (err: any) {
      console.error('Error loading profile:', err);
      return { success: false, error: err.message || 'Failed to load profile' };
    }
  }

}

