import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule } from '@ionic/angular';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../firebase';
import { TeacherService } from '../../services/teacher.service';

@Component({
  selector: 'app-question-generator',
  templateUrl: './question-generator.page.html',
  styleUrls: ['./question-generator.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class QuestionGeneratorPage implements OnInit {
  classId!: number;
  subjectId!: number;
  className = '';
  subjectName = '';
  tos: TopicEntry[] = [];
  topicOptions: string[] = [];
  selectedTopic = '';
  questions: {
    topic: string;
    competency: string;
    level: string;
    question: string;
    choices: { A: string; B: string; C: string; D: string };
    answer: 'A' | 'B' | 'C' | 'D' | '';
  }[] = [];

  isGeneratingAI = false;
  isLoadingTos = false;
  promptText = '';
  isPromptingAI = false;
  isChatOpen = false;
  chatMessages: { role: 'user' | 'gemini'; text: string; ts: number }[] = [];

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService,
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

  private async presentConfirm(message: string, header = ''): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'confirm' },
      ],
    });
    await alert.present();
    const res = await alert.onDidDismiss();
    return res.role === 'confirm';
  }

  private normalizeTosRow(row: any): TopicEntry | null {
    if (!row || typeof row !== 'object') return null;
    const topicName = String((row as any)?.topicName ?? (row as any)?.topic ?? '').trim();
    if (!topicName) return null;
    const learningCompetency = String((row as any)?.learningCompetency ?? (row as any)?.competency ?? '').trim();
    return {
      topicName,
      learningCompetency,
      days: Number((row as any)?.days || 0),
      percent: Number((row as any)?.percent || 0),
      expectedItems: Number((row as any)?.expectedItems || 0),
      remembering: Number((row as any)?.remembering || 0),
      understanding: Number((row as any)?.understanding || 0),
      applying: Number((row as any)?.applying || 0),
      analyzing: Number((row as any)?.analyzing || 0),
      evaluating: Number((row as any)?.evaluating || 0),
      creating: Number((row as any)?.creating || 0),
    };
  }

  private recomputeTopicOptions() {
    this.topicOptions = Array.from(
      new Set((this.tos || []).map((t) => String(t.topicName || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }

  async ngOnInit() {
    await LocalDataService.load();
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    if (!Number.isFinite(this.classId) || !Number.isFinite(this.subjectId)) {
      await this.presentAlert(
        'Missing class/subject. Please go back to TOS and open Question Generator again.'
      );
      return;
    }

    const cls = LocalDataService.getClass(this.classId);
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);

    this.tos = (Array.isArray(subject?.tos) ? subject?.tos : [])
      .map((r: any) => this.normalizeTosRow(r))
      .filter(Boolean) as TopicEntry[];

    // Load cached questions (fallback) while we fetch from Firebase.
    this.questions = Array.isArray(subject?.questions) ? (subject?.questions as any[]) : [];

    this.className = cls?.name || '';
    this.subjectName = subject?.name || '';

    this.recomputeTopicOptions();

    if (this.topicOptions.length && !this.topicOptions.includes(this.selectedTopic)) {
      this.selectedTopic = this.topicOptions[0];
    }

    await this.loadTosFromFirebase();

    // Prefer Firebase-saved questions over local cache.
    try {
      const qRes = await this.teacherService.loadSubjectQuestions(this.classId, this.subjectId);
      if (qRes.success && Array.isArray(qRes.questions) && qRes.questions.length) {
        this.questions = qRes.questions as any[];
        if (subject) {
          subject.questions = this.questions;
          await LocalDataService.save();
        }
      }
    } catch (e) {
      console.error(e);
    }

    if (this.topicOptions.length && !this.topicOptions.includes(this.selectedTopic)) {
      this.selectedTopic = this.topicOptions[0];
    }

    if (!this.topicOptions.length) {
      await this.presentAlert(
        'No topics found. Please add and Save TOS first, then open Question Generator again.'
      );
      return;
    }

    if (!this.questions.length) {
      this.generateQuestions();
    }
  }

  private shuffle<T>(arr: T[], seed: number): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.seededInt(seed + i, 0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private makeMathMcq(
    question: string,
    correct: number,
    seed: number,
    variant: 'add' | 'sub' | 'mul' | 'div'
  ): { question: string; choices: { A: string; B: string; C: string; D: string }; answer: 'A' | 'B' | 'C' | 'D' } {
    const distractors = new Set<number>();
    distractors.add(correct);

    const bump = (k: number) => {
      if (variant === 'mul') return correct + k * this.seededInt(seed + k, 1, 6);
      if (variant === 'div') return Math.max(0, correct + k * this.seededInt(seed + k, 1, 4));
      return correct + k * this.seededInt(seed + k, 1, 12);
    };

    let k = 1;
    while (distractors.size < 4) {
      distractors.add(bump(k));
      distractors.add(bump(-k));
      k++;
    }

    const vals = Array.from(distractors).slice(0, 4);
    const shuffled = this.shuffle(vals, seed + 99);
    const correctIndex = shuffled.indexOf(correct);
    const letters = ['A', 'B', 'C', 'D'] as const;
    const answer = letters[Math.max(0, correctIndex)] || 'A';

    const choices = {
      A: String(shuffled[0]),
      B: String(shuffled[1]),
      C: String(shuffled[2]),
      D: String(shuffled[3]),
    };

    return { question, choices, answer };
  }

  private async loadTosFromFirebase() {
    this.isLoadingTos = true;
    try {
      const res = await this.teacherService.loadSubjectTos(this.classId, this.subjectId);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to load TOS from Firebase');
        return;
      }

      if (Array.isArray(res.tos)) {
        const local = Array.isArray(this.tos) ? this.tos : [];
        const remote = res.tos
          .map((r: any) => this.normalizeTosRow(r))
          .filter(Boolean) as TopicEntry[];
        const seen = new Set<string>();
        const merged: TopicEntry[] = [];
        for (const row of [...remote, ...local]) {
          const topicName = String((row as any)?.topicName || '').trim();
          const learningCompetency = String((row as any)?.learningCompetency || '').trim();
          const key = `${topicName}|||${learningCompetency}`;
          if (!topicName) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            ...(row as any),
            topicName,
            learningCompetency,
          });
        }

        this.tos = merged;

        this.recomputeTopicOptions();

        if (this.topicOptions.length && !this.topicOptions.includes(this.selectedTopic)) {
          this.selectedTopic = this.topicOptions[0];
        }

        LocalDataService.saveTOS(this.classId, this.subjectId, this.tos);
        await LocalDataService.save();
      }
    } catch (e) {
      console.error(e);
      await this.presentAlert((e as any)?.message || 'Failed to load TOS from Firebase');
    } finally {
      this.isLoadingTos = false;
    }
  }

  onTopicChange() {
    this.generateQuestions();
  }

  private hashSeed(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private seededInt(seed: number, min: number, max: number): number {
    let x = seed >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967296;
    return Math.floor(r * (max - min + 1)) + min;
  }

  private buildTemplateQuestion(
    topic: string,
    competency: string,
    level: string,
    n: number
  ): { question: string; choices: { A: string; B: string; C: string; D: string }; answer: 'A' | 'B' | 'C' | 'D' | '' } {
    const t = String(topic || '').trim();
    const rawCompetency = String(competency || '').trim();
    const c = rawCompetency && !/^\d+$/.test(rawCompetency) ? rawCompetency : '';
    const l = String(level || '').trim();
    const key = `${t}|${c}|${l}|${n}`;
    const seed = this.hashSeed(key);
    const lower = t.toLowerCase();

    const wantsMultiplication = /multiplication|multiply|times|product/.test(lower);
    const wantsDivision = /division|divide|quotient/.test(lower);
    const wantsAddition = /addition|add|sum/.test(lower);
    const wantsSubtraction = /subtraction|subtract|difference/.test(lower);

    if (wantsMultiplication) {
      const a = this.seededInt(seed, 2, 12);
      const b = this.seededInt(seed + 1, 2, 12);
      const stem = l === 'applying'
        ? `A group has ${a} rows with ${b} items each. How many items are there in all?`
        : `Compute: ${a} × ${b}`;
      return this.makeMathMcq(stem, a * b, seed, 'mul');
    }

    if (wantsDivision) {
      const b = this.seededInt(seed, 2, 12);
      const q = this.seededInt(seed + 1, 2, 12);
      const a = b * q;
      const stem = l === 'applying'
        ? `${a} items are shared equally among ${b} students. How many does each student get?`
        : `Compute: ${a} ÷ ${b}`;
      return this.makeMathMcq(stem, q, seed, 'div');
    }

    if (wantsAddition) {
      const a = this.seededInt(seed, 10, 99);
      const b = this.seededInt(seed + 1, 10, 99);
      const stem = l === 'applying'
        ? `You have ${a} pesos and receive ${b} more. How much money do you have now?`
        : `Compute: ${a} + ${b}`;
      return this.makeMathMcq(stem, a + b, seed, 'add');
    }

    if (wantsSubtraction) {
      const a = this.seededInt(seed, 20, 120);
      const b = this.seededInt(seed + 1, 1, Math.min(99, a - 1));
      const stem = l === 'applying'
        ? `You have ${a} candies and give away ${b}. How many are left?`
        : `Compute: ${a} − ${b}`;
      return this.makeMathMcq(stem, a - b, seed, 'sub');
    }

    const stem = c || t;
    const q =
      l === 'remembering' ? `Define: ${stem}` :
      l === 'understanding' ? `Explain: ${stem}` :
      l === 'applying' ? `Apply the concept of ${stem} in a real-life example.` :
      l === 'analyzing' ? `Analyze the following situation related to ${stem}. What are the key parts and relationships?` :
      l === 'evaluating' ? `Evaluate this statement about ${stem}. Do you agree? Justify your answer.` :
      l === 'creating' ? `Create a short problem or scenario that demonstrates ${stem}.` :
      `${stem}`;

    return {
      question: q,
      choices: { A: '', B: '', C: '', D: '' },
      answer: '',
    };
  }

  generateQuestions() {
    this.questions = [];

    const cognitiveLevels = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating'
    ];

    const topic = String(this.selectedTopic || '').trim();
    const tos = this.tos.filter(t => String(t.topicName || '').trim() === topic);

    tos.forEach((entry) => {
      cognitiveLevels.forEach((level) => {
        const count = Number(entry[level as keyof TopicEntry] || 0);
        for (let i = 1; i <= count; i++) {
          const built = this.buildTemplateQuestion(entry.topicName, entry.learningCompetency, level, i);
          this.questions.push({
            topic: entry.topicName,
            competency: entry.learningCompetency,
            level: level,
            question: built.question,
            choices: built.choices,
            answer: built.answer,
          });
        }
      });
    });
  }

  private normalizeAnswerLetter(v: any): 'A' | 'B' | 'C' | 'D' | '' {
    const s = String(v || '').trim().toUpperCase();
    return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? (s as any) : '';
  }

  async askGemini() {
    if (this.isPromptingAI) return;
    const prompt = String(this.promptText || '').trim();
    if (!prompt) {
      await this.presentAlert('Type your prompt first.');
      return;
    }

    this.chatMessages = [
      ...this.chatMessages,
      { role: 'user', text: prompt, ts: Date.now() },
    ];

    this.isPromptingAI = true;
    try {
      const fn = httpsCallable(
        firebaseFunctions(),
        'generateQuestionsWithAI'
      ) as any;

      const res = await fn({
        mode: 'mcq',
        prompt,
        count: 5,
      });

      const items: any[] = Array.isArray(res?.data?.questions) ? res.data.questions : [];
      const rawTextItems = items.filter((it) => typeof it === 'string').map((it) => String(it));
      const mapped = items
        .map((it) => {
          if (!it || typeof it !== 'object') return null;
          const qText = String(it?.question || '').trim();
          const choices = it?.choices && typeof it.choices === 'object' ? it.choices : {};
          const A = String(choices?.A || '').trim();
          const B = String(choices?.B || '').trim();
          const C = String(choices?.C || '').trim();
          const D = String(choices?.D || '').trim();
          const ans = this.normalizeAnswerLetter(it?.answer);

          if (!qText || !A || !B || !C || !D || !ans) return null;

          return {
            topic: this.selectedTopic,
            competency: '',
            level: 'remembering',
            question: qText,
            choices: { A, B, C, D },
            answer: ans,
          };
        })
        .filter(Boolean) as any[];

      if (!mapped.length) {
        const fallbackText = rawTextItems.length ? rawTextItems.join('\n\n') : 'No questions returned.';
        await this.presentAlert(fallbackText);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: fallbackText, ts: Date.now() },
        ];
        return;
      }

      this.questions = [...mapped, ...this.questions];
      this.chatMessages = [
        ...this.chatMessages,
        { role: 'gemini', text: `Inserted ${mapped.length} MCQ(s) into your list.`, ts: Date.now() },
      ];
      this.promptText = '';
    } catch (e: any) {
      const code = e?.code ? String(e.code) : '';
      const message = e?.message ? String(e.message) : String(e);
      const details = e?.details ? (typeof e.details === 'string' ? e.details : JSON.stringify(e.details)) : '';

      if (code === 'functions/resource-exhausted') {
        const msg =
          'Gemini quota/rate limit exceeded.\n' +
          'You can still use the locally-generated MCQs for now.\n' +
          'Please wait a bit and try again, or check Gemini API quota/billing.';
        await this.presentAlert(msg);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: msg, ts: Date.now() },
        ];
      } else {
        const msg = [code, message, details].filter(Boolean).join('\n');
        await this.presentAlert(msg);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: msg, ts: Date.now() },
        ];
      }
    } finally {
      this.isPromptingAI = false;
    }
  }

  async generateWithAI() {
    if (this.isGeneratingAI) return;

    if (!this.questions.length) {
      await this.presentAlert('No questions to generate.');
      return;
    }

    this.isGeneratingAI = true;
    try {
      const fn = httpsCallable(
        firebaseFunctions(),
        'generateQuestionsWithAI'
      ) as any;

      const groups = new Map<string, number[]>();
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i];
        const key = `${q.topic}|||${q.competency}|||${q.level}`;
        const arr = groups.get(key);
        if (arr) {
          arr.push(i);
        } else {
          groups.set(key, [i]);
        }
      }

      for (const [key, indexes] of groups.entries()) {
        const [topic, competency, cognitiveLevel] = key.split('|||');
        const count = indexes.length;

        const res = await fn({
          topic,
          competency,
          cognitiveLevel,
          count,
          mode: 'mcq',
        });

        const items: any[] = Array.isArray(res?.data?.questions) ? res.data.questions : [];
        for (let j = 0; j < indexes.length; j++) {
          const idx = indexes[j];
          const it = items[j];
          if (it && typeof it === 'object') {
            const qText = String(it.question || '').trim();
            const choices = it.choices && typeof it.choices === 'object' ? it.choices : {};
            const A = String(choices.A || '').trim();
            const B = String(choices.B || '').trim();
            const C = String(choices.C || '').trim();
            const D = String(choices.D || '').trim();
            const ans = this.normalizeAnswerLetter(it.answer);

            if (qText) this.questions[idx].question = qText;
            this.questions[idx].choices = { A, B, C, D };
            this.questions[idx].answer = ans;
          }
        }
      }
    } catch (e: any) {
      const code = e?.code ? String(e.code) : '';
      const message = e?.message ? String(e.message) : String(e);
      const details = e?.details ? (typeof e.details === 'string' ? e.details : JSON.stringify(e.details)) : '';

      if (code === 'functions/resource-exhausted') {
        await this.presentAlert(
          'Gemini quota/rate limit exceeded.\n' +
          'Keeping your current (template) MCQs.\n' +
          'Please wait a bit and try again, or check Gemini API quota/billing.'
        );
      } else {
        await this.presentAlert([code, message, details].filter(Boolean).join('\n'));
      }
    } finally {
      this.isGeneratingAI = false;
    }
  }

  async saveQuestions() {
    try {
      const res = await this.teacherService.saveSubjectQuestions(this.classId, this.subjectId, this.questions);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to save questions');
        return;
      }

      const subject = LocalDataService.getSubject(this.classId, this.subjectId);
      if (subject) {
        subject.questions = this.questions;
        await LocalDataService.save();
      }
      await this.presentAlert('Questions saved to Firebase!');
    } catch (e: any) {
      await this.presentAlert(e?.message || 'Failed to save questions');
    }
  }

  async deleteQuestion(index: number) {
    if (!Number.isFinite(index) || index < 0 || index >= this.questions.length) return;
    const ok = await this.presentConfirm('Delete this question?');
    if (!ok) return;
    this.questions = this.questions.filter((_, i) => i !== index);
  }
}
