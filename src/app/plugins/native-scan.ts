import { registerPlugin } from '@capacitor/core';

export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export interface NativeScanResult {
  ok: boolean;
  error?: string;
  answers?: Record<string, OptionLetter | null>;
  score?: number;
  total?: number;
  correctCount?: number;
  incorrectCount?: number;
  blankCount?: number;
  overlayImageBase64?: string;
}

export interface NativeScanPlugin {
  ping(): Promise<{ ok: boolean; message: string }>;
  scanSheet(options: {
    imageBase64: string;
    maxItems: number;
    answerKey: Record<string, OptionLetter>;
    template?: Array<{
      question: number;
      options: Record<OptionLetter, { cx: number; cy: number; radius: number }>;
    }>;
  }): Promise<NativeScanResult>;
}

export const NativeScan = registerPlugin<NativeScanPlugin>('NativeScan');
