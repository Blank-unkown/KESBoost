
import { Preferences } from '@capacitor/preferences';

export interface TopicEntry {
  topicName: string;
  learningCompetency: string;
  days: number;
  percent: number;
  expectedItems?: number;
  remembering?: number;
  understanding?: number;
  applying?: number;
  analyzing?: number;
  evaluating?: number;
  creating?: number;
}

export interface AnswerEntry {
  question: number;
  marked: string | null;        // what student selected
  correctAnswer: string | null; // key from teacher
  correct: boolean;             // true/false
  topic?: string | null;        // 🔹 from TOS mapping
  competency?: string | null;   // 🔹 from TOS mapping
  level?: string | null;        // 🔹 Bloom’s level
}


export interface ScannedResult {
  id: number;
  headerImage: string;
  fullImage: string;
  answers: AnswerEntry[];
  score: number;
  total: number;
  subjectId: number;
  classId: number;
  timestamp: string;
  answerDistribution: Record<'A'|'B'|'C'|'D', number>;
  cognitiveBreakdown: { [level: string]: { correct: number; total: number } };
  // ✅ new field: snapshot of TOS rows
  tosRows: TopicEntry[];
}

export interface TosRow {
  topic: string;
  competency: string;
  level: string;
  percentage: number;
  numItems: number;
  startQuestion: number;
  endQuestion: number;
  cognitives?: { level: string; rawValue: number }[];   // <-- add this field for display
}

export interface Subject {
  id: number;
  name: string;
  tos: TopicEntry[];
  tosRows?: TosRow[];   // ✅ added so `subject.tosRows` works
  questions?: any[];
  answerKey?: string[];
  results?: ScannedResult[];
}


export interface Class {
  id: number;
  name: string;
  subjects: Subject[];
}

export class LocalDataService {
  private static classes: Class[] = [];

  // Load from storage into memory
  static async load(): Promise<void> {
    const stored = await Preferences.get({ key: 'examData' });
    if (stored.value) {
      this.classes = JSON.parse(stored.value);
    } else {
      this.classes = [];
    }
  }

  static async save(): Promise<void> {
    await Preferences.set({ key: 'examData', value: JSON.stringify(this.classes) });
  }

  static getClasses(): Class[] {
    return this.classes;
  }

  static addClass(name: string) {
    const newClass: Class = {
      id: Date.now(),
      name,
      subjects: []
    };
    this.classes.push(newClass);
  }

  static getClass(id: number): Class | undefined {
    return this.classes.find(cls => cls.id === id);
  }
 // 🔹 Delete Class by ID
  static deleteClass(classId: number) {
    this.classes = this.classes.filter(cls => cls.id !== classId);
    this.save();
  }

  // 🔹 Delete Subject by ID inside a Class
  static deleteSubject(classId: number, subjectId: number) {
    const cls = this.getClass(classId);
    if (cls) {
      cls.subjects = cls.subjects.filter(sub => sub.id !== subjectId);
      this.save();
    }
  }
  static addSubject(classId: number, subjectName: string) {
    const cls = this.getClass(classId);
    if (cls) {
      const newSubject: Subject = {
        id: Date.now(),
        name: subjectName,
        tos: [],
        questions: [],
        answerKey: []
      };
      cls.subjects.push(newSubject);
    }
  }

  static getSubject(classId: number, subjectId: number): Subject | undefined {
    return this.getClass(classId)?.subjects.find(sub => sub.id === subjectId);
  }

  static saveTOS(classId: number, subjectId: number, tos: TopicEntry[]) {
    const subject = this.getSubject(classId, subjectId);
    if (subject) {
      subject.tos = tos;
      subject.tosRows = this.generateTOSRows(tos);  // ✅ auto-generate tosRows
    }
  }

  static generateTOSMap(tos: TopicEntry[]): {
    question: number;
    topic: string;
    competency: string;
    level: string;
  }[] {
    const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];
    const map: any[] = [];
    let qNum = 1;

    tos.forEach(topic => {
      cognitiveLevels.forEach(level => {
        const count = Number(topic[level as keyof TopicEntry] || 0);
        for (let i = 0; i < count; i++) {
          map.push({
            question: qNum++,
            topic: topic.topicName,
            competency: topic.learningCompetency,
            level
          });
        }
      });
    });

    return map;
  }
static generateTOSRows(tos: TopicEntry[]): TosRow[] {
  const rows: TosRow[] = [];
  const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];

  let qNum = 1;

  tos.forEach(entry => {
    cognitiveLevels.forEach(level => {
      const count = Number(entry[level as keyof TopicEntry] || 0);
      if (count > 0) {
        const row: TosRow = {
          topic: entry.topicName,
          competency: entry.learningCompetency,
          level,
          percentage: entry.percent,
          numItems: count,
          startQuestion: qNum,
          endQuestion: qNum + count - 1,
          // ✅ Only include this level’s value
          cognitives: [
            { level, rawValue: count }
          ]
        };
        rows.push(row);
        qNum += count;
      }
    });
  });

  return rows;
}


  static saveScannedResult(classId: number, subjectId: number, result: ScannedResult) {
    const subject = this.getSubject(classId, subjectId);
    if (!subject) return;
    subject.results = subject.results || [];
    subject.results.push(result);
    this.save(); // still async-compatible
  }

  
  // 🔹 NEW: Get all results for a subject
  static getResultsBySubject(classId: number, subjectId: number): ScannedResult[] {
    const subject = this.getSubject(classId, subjectId);
    return subject?.results || [];
  }

  // 🔹 NEW: Compute mean percentage for subject
  static getMeanPercentage(classId: number, subjectId: number): number {
    const results = this.getResultsBySubject(classId, subjectId);
    if (!results.length) return 0;
    const totalPercent = results.reduce((sum, r) => sum + (r.score / r.total) * 100, 0);
    return totalPercent / results.length;
  }
  // 🔹 Inside LocalDataService
  static getAggregatedAnswerDistribution(classId: number, subjectId: number) {
    const results = this.getResultsBySubject(classId, subjectId);
    const counts = { A: 0, B: 0, C: 0, D: 0 };

    results.forEach(r => {
      r.answers.forEach(a => {
        if (a.marked) counts[a.marked as "A" | "B" | "C" | "D"]++;
      });
    });

    return counts;
  }

  static getAggregatedCognitiveBreakdown(classId: number, subjectId: number) {
    const results = this.getResultsBySubject(classId, subjectId);
    const breakdown: { [level: string]: { correct: number; total: number } } = {};

    results.forEach(r => {
      r.answers.forEach(a => {
        const level = a.level || "N/A";
        if (!breakdown[level]) breakdown[level] = { correct: 0, total: 0 };
        breakdown[level].total++;
        if (a.correct) breakdown[level].correct++;
      });
    });

    return breakdown;
  }
}

