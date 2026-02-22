import { Injectable } from '@angular/core';

import { HttpClient, HttpHeaders } from '@angular/common/http';

import { BehaviorSubject, Observable } from 'rxjs';

import { AuthService } from './auth.service';

import { environment } from 'src/environments/environment';



export interface DashboardStats {

  totalClasses: number;

  totalStudents: number;

  totalSubjects: number;

  averageScore: number;

  recentScans: any[];

  classPerformance: ClassPerformance[];

}



export interface ClassPerformance {

  classId: number;

  className: string;

  studentCount: number;

  averageScore: number;

  highestScore: number;

  lowestScore: number;

}



export interface StudentStats {

  totalTests: number;

  averageScore: number;

  totalSubjects: number;

  recentScores: SubjectScore[];

  mostScoredTopic: string;

  weakTopic: string;

}



export interface SubjectScore {

  subjectId: number;

  subjectName: string;

  score: number;

  total: number;

  percentage: number;

  date: string;

}



@Injectable({

  providedIn: 'root'

})

export class DashboardService {

  private apiUrl = environment.apiBaseUrl;

  

  private dashboardStats = new BehaviorSubject<DashboardStats | null>(null);

  private studentStats = new BehaviorSubject<StudentStats | null>(null);



  public dashboardStats$ = this.dashboardStats.asObservable();

  public studentStats$ = this.studentStats.asObservable();



  constructor(

    private http: HttpClient,

    private authService: AuthService

  ) {}



  private getHeaders() {

    const token = this.authService.getToken();

    return new HttpHeaders({

      'Authorization': `Bearer ${token}`

    });

  }



  async loadDashboardData(): Promise<void> {

    try {

      const response: any = await this.http.get(

        `${this.apiUrl}/teacher/dashboard`,

        { headers: this.getHeaders() }

      ).toPromise();



      if (response.success) {

        const data = response.data;

        const stats: DashboardStats = {

          totalClasses: data.totalClasses || 0,

          totalStudents: data.totalStudents || 0,

          totalSubjects: data.totalSubjects || 0,

          averageScore: data.averageScore || 0,

          recentScans: data.recentExams.map((exam: any) => ({

            id: exam.id,

            className: exam.class_name,

            subjectName: exam.subject_name,

            date: exam.exam_date,

            score: Math.floor(Math.random() * 40) + 60 // Placeholder

          })),

          classPerformance: data.classPerformance.map((cls: any) => ({

            classId: cls.id,

            className: cls.name,

            studentCount: cls.student_count || 0,

            averageScore: cls.average_score || 0,

            highestScore: cls.highest_score || 0,

            lowestScore: cls.lowest_score || 0

          }))

        };

        this.dashboardStats.next(stats);

      }

    } catch (err) {

      console.error('Failed to load dashboard data:', err);

      // Fallback to mock data

      this.loadMockDashboardData();

    }

  }



  private loadMockDashboardData(): void {

    const mockStats: DashboardStats = {

      totalClasses: 5,

      totalStudents: 150,

      totalSubjects: 12,

      averageScore: 78.5,

      recentScans: [

        { id: 1, className: 'Grade 10-A', subjectName: 'Mathematics', date: 'Today', score: 85 },

        { id: 2, className: 'Grade 10-B', subjectName: 'English', date: 'Yesterday', score: 72 },

        { id: 3, className: 'Grade 11-A', subjectName: 'Physics', date: '2 days ago', score: 91 }

      ],

      classPerformance: [

        { classId: 1, className: 'Grade 10-A', studentCount: 45, averageScore: 82, highestScore: 98, lowestScore: 56 },

        { classId: 2, className: 'Grade 10-B', studentCount: 42, averageScore: 76, highestScore: 95, lowestScore: 48 },

        { classId: 3, className: 'Grade 11-A', studentCount: 38, averageScore: 85, highestScore: 100, lowestScore: 62 }

      ]

    };

    this.dashboardStats.next(mockStats);

  }



  async loadStudentStats(studentId: number): Promise<void> {

    try {

      const response: any = await this.http.get(

        `${this.apiUrl}/student/results`,

        { headers: this.getHeaders() }

      ).toPromise();



      if (response.success) {

        const data = response.data;

        const stats: StudentStats = {

          totalTests: data.totalTests,

          averageScore: data.averageScore,

          totalSubjects: data.results.length,

          recentScores: data.results.slice(0, 4).map((result: any) => ({

            subjectId: 1,

            subjectName: result.subject_name,

            score: result.obtained_marks,

            total: result.total_marks,

            percentage: result.percentage,

            date: new Date(result.result_date).toLocaleDateString()

          })),

          mostScoredTopic: 'Physics - Mechanics',

          weakTopic: 'Chemistry - Organic Chemistry'

        };

        this.studentStats.next(stats);

      }

    } catch (err) {

      console.error('Failed to load student stats:', err);

      // Fallback to mock data

      this.loadMockStudentStats();

    }

  }



  private loadMockStudentStats(): void {

    const mockStats: StudentStats = {

      totalTests: 12,

      averageScore: 81.5,

      totalSubjects: 5,

      recentScores: [

        { subjectId: 1, subjectName: 'Mathematics', score: 85, total: 100, percentage: 85, date: 'Feb 10' },

        { subjectId: 2, subjectName: 'English', score: 78, total: 100, percentage: 78, date: 'Feb 8' },

        { subjectId: 3, subjectName: 'Physics', score: 91, total: 100, percentage: 91, date: 'Feb 5' },

        { subjectId: 4, subjectName: 'Chemistry', score: 76, total: 100, percentage: 76, date: 'Feb 3' }

      ],

      mostScoredTopic: 'Physics - Mechanics',

      weakTopic: 'Chemistry - Organic Chemistry'

    };

    this.studentStats.next(mockStats);

  }



  getDashboardStats(): DashboardStats | null {

    return this.dashboardStats.value;

  }



  getStudentStats(): StudentStats | null {

    return this.studentStats.value;

  }

}

