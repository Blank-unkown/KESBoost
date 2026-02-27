export type Option = 'A' | 'B' | 'C' | 'D';

export interface BubbleCoordinate {
  cx: number;
  cy: number;
  radius: number;
}

export interface BubbleTemplate {
  question: number;
  options: {
    A: BubbleCoordinate;
    B: BubbleCoordinate;
    C: BubbleCoordinate;
    D: BubbleCoordinate;
  };
  topic?: string;
  competency?: string;
  level?: string;
}

/**
 * PRODUCTION-READY OMR TEMPLATE (50 Questions)
 * Optimized for A4 aspect ratio (800x1131)
 * 
 * Layout:
 * - 2 Columns of 25 questions each
 * - Column 1: Questions 1-25 (Left)
 * - Column 2: Questions 26-50 (Right)
 * - Header space: 0-250px
 * - Footer space: 1050-1131px (for corner markers)
 */

const START_Y = 315; // Lowered to make room for column labels
const ROW_HEIGHT = 30;
const COL1_X = 160;
const COL2_X = 520;
const BUBBLE_GAP = 45;
const RADIUS = 14;

function generateBubbles(): BubbleTemplate[] {
  const template: BubbleTemplate[] = [];

  for (let i = 1; i <= 50; i++) {
    const isCol2 = i > 25;
    const rowIndex = isCol2 ? i - 26 : i - 1;
    const startX = isCol2 ? COL2_X : COL1_X;
    const cy = START_Y + rowIndex * ROW_HEIGHT;

    template.push({
      question: i,
      options: {
        A: { cx: startX, cy: cy, radius: RADIUS },
        B: { cx: startX + BUBBLE_GAP, cy: cy, radius: RADIUS },
        C: { cx: startX + BUBBLE_GAP * 2, cy: cy, radius: RADIUS },
        D: { cx: startX + BUBBLE_GAP * 3, cy: cy, radius: RADIUS },
      }
    });
  }

  return template;
}

export const bubbles: BubbleTemplate[] = generateBubbles();
