
export type Option = 'A' | 'B' | 'C' | 'D';

export interface BubbleCoordinate {
  cx: number;
  cy: number;
  radius: number; // Add this line to include the radius property
}

export interface BubbleTemplate {
  question: number;
  options: {
    A: BubbleCoordinate;
    B: BubbleCoordinate;
    C: BubbleCoordinate;
    D: BubbleCoordinate;
  };
    topic?: string;       // ✅ added
    competency?: string;  // ✅ added
    level?: string;       // ✅ added
}

// Fixed coordinates for a 20-question sheet (2-column layout)
// Left column: Q1–10, Right column: Q11–20
export const bubbles: BubbleTemplate[] = [
  // Column 1: Q1–10
  { question: 1, options: { A: { cx: 100, cy: 235, radius: 15 }, B: { cx: 135, cy: 235, radius: 15 }, C: { cx: 170, cy: 235, radius: 15 }, D: { cx: 205, cy: 235, radius: 15 } } },
  { question: 2, options: { A: { cx: 100, cy: 280, radius: 15 }, B: { cx: 135, cy: 280, radius: 15 }, C: { cx: 170, cy: 280, radius: 15 }, D: { cx: 205, cy: 280, radius: 15 } } },
  { question: 3, options: { A: { cx: 100, cy: 325, radius: 15 }, B: { cx: 135, cy: 325, radius: 15 }, C: { cx: 170, cy: 325, radius: 15 }, D: { cx: 205, cy: 325, radius: 15 } } },
  { question: 4, options: { A: { cx: 100, cy: 370, radius: 15 }, B: { cx: 135, cy: 370, radius: 15 }, C: { cx: 170, cy: 370, radius: 15 }, D: { cx: 205, cy: 370, radius: 15 } } },
  { question: 5, options: { A: { cx: 100, cy: 410, radius: 15 }, B: { cx: 135, cy: 410, radius: 15 }, C: { cx: 170, cy: 410, radius: 15 }, D: { cx: 205, cy: 410, radius: 15 } } },
  { question: 6, options: { A: { cx: 100, cy: 450, radius: 15 }, B: { cx: 135, cy: 450, radius: 15 }, C: { cx: 170, cy: 450, radius: 15 }, D: { cx: 205, cy: 450, radius: 15 } } },
  { question: 7, options: { A: { cx: 100, cy: 490, radius: 15 }, B: { cx: 135, cy: 490, radius: 15 }, C: { cx: 170, cy: 490, radius: 15 }, D: { cx: 205, cy: 490, radius: 15 } } },
  { question: 8, options: { A: { cx: 100, cy: 530, radius: 15 }, B: { cx: 135, cy: 530, radius: 15 }, C: { cx: 170, cy: 530, radius: 15 }, D: { cx: 205, cy: 530, radius: 15 } } },
  { question: 9, options: { A: { cx: 100, cy: 570, radius: 15 }, B: { cx: 135, cy: 570, radius: 15 }, C: { cx: 170, cy: 570, radius: 15 }, D: { cx: 205, cy: 570, radius: 15 } } },
  { question: 10, options: { A: { cx: 100, cy: 610, radius: 15 }, B: { cx: 135, cy: 610, radius: 15 }, C: { cx: 170, cy: 610, radius: 15 }, D: { cx: 205, cy: 610, radius: 15 } } },

  // Column 2: Q11–20
  { question: 11, options: { A: { cx: 350, cy: 235, radius: 15 }, B: { cx: 385, cy: 235, radius: 15 }, C: { cx: 420, cy: 235, radius: 15 }, D: { cx: 455, cy: 235, radius: 15 } } },
  { question: 12, options: { A: { cx: 350, cy: 280, radius: 15 }, B: { cx: 385, cy: 280, radius: 15 }, C: { cx: 420, cy: 280, radius: 15 }, D: { cx: 455, cy: 280, radius: 15 } } },
  { question: 13, options: { A: { cx: 350, cy: 325, radius: 15 }, B: { cx: 385, cy: 325, radius: 15 }, C: { cx: 420, cy: 325, radius: 15 }, D: { cx: 455, cy: 325, radius: 15 } } },
  { question: 14, options: { A: { cx: 350, cy: 370, radius: 15 }, B: { cx: 385, cy: 370, radius: 15 }, C: { cx: 420, cy: 370, radius: 15 }, D: { cx: 455, cy: 370, radius: 15 } } },
  { question: 15, options: { A: { cx: 350, cy: 410, radius: 15 }, B: { cx: 385, cy: 410, radius: 15 }, C: { cx: 420, cy: 410, radius: 15 }, D: { cx: 455, cy: 410, radius: 15 } } },
  { question: 16, options: { A: { cx: 350, cy: 450, radius: 15 }, B: { cx: 385, cy: 450, radius: 15 }, C: { cx: 420, cy: 450, radius: 15 }, D: { cx: 455, cy: 450, radius: 15 } } },
  { question: 17, options: { A: { cx: 350, cy: 490, radius: 15 }, B: { cx: 385, cy: 490, radius: 15 }, C: { cx: 420, cy: 490, radius: 15 }, D: { cx: 455, cy: 490, radius: 15 } } },
  { question: 18, options: { A: { cx: 350, cy: 530, radius: 15 }, B: { cx: 385, cy: 530, radius: 15 }, C: { cx: 420, cy: 530, radius: 15 }, D: { cx: 455, cy: 530, radius: 15 } } },
  { question: 19, options: { A: { cx: 350, cy: 570, radius: 15 }, B: { cx: 385, cy: 570, radius: 15 }, C: { cx: 420, cy: 570, radius: 15 }, D: { cx: 455, cy: 570, radius: 15 } } },
  { question: 20, options: { A: { cx: 350, cy: 610, radius: 15 }, B: { cx: 385, cy: 610, radius: 15 }, C: { cx: 420, cy: 610, radius: 15 }, D: { cx: 455, cy: 610, radius: 15 } } },

  // Column 3: Q21–30
  { question: 21, options: { A: { cx: 590, cy: 235, radius: 15 }, B: { cx: 630, cy: 235, radius: 15 }, C: { cx: 670, cy: 235, radius: 15 }, D: { cx: 710, cy: 235, radius: 15 } } },
  { question: 22, options: { A: { cx: 590, cy: 280, radius: 15 }, B: { cx: 630, cy: 280, radius: 15 }, C: { cx: 670, cy: 280, radius: 15 }, D: { cx: 710, cy: 280, radius: 15 } } },
  { question: 23, options: { A: { cx: 590, cy: 325, radius: 15 }, B: { cx: 630, cy: 325, radius: 15 }, C: { cx: 670, cy: 325, radius: 15 }, D: { cx: 710, cy: 325, radius: 15 } } },
  { question: 24, options: { A: { cx: 590, cy: 370, radius: 15 }, B: { cx: 630, cy: 370, radius: 15 }, C: { cx: 670, cy: 370, radius: 15 }, D: { cx: 710, cy: 370, radius: 15 } } },
  { question: 25, options: { A: { cx: 590, cy: 410, radius: 15 }, B: { cx: 630, cy: 410, radius: 15 }, C: { cx: 670, cy: 410, radius: 15 }, D: { cx: 710, cy: 410, radius: 15 } } },
  { question: 26, options: { A: { cx: 590, cy: 450, radius: 15 }, B: { cx: 630, cy: 450, radius: 15 }, C: { cx: 670, cy: 450, radius: 15 }, D: { cx: 710, cy: 450, radius: 15 } } },
  { question: 27, options: { A: { cx: 590, cy: 490, radius: 15 }, B: { cx: 630, cy: 490, radius: 15 }, C: { cx: 670, cy: 490, radius: 15 }, D: { cx: 710, cy: 490, radius: 15 } } },
  { question: 28, options: { A: { cx: 590, cy: 530, radius: 15 }, B: { cx: 630, cy: 530, radius: 15 }, C: { cx: 670, cy: 530, radius: 15 }, D: { cx: 710, cy: 530, radius: 15 } } },
  { question: 29, options: { A: { cx: 590, cy: 570, radius: 15 }, B: { cx: 630, cy: 570, radius: 15 }, C: { cx: 670, cy: 570, radius: 15 }, D: { cx: 710, cy: 570, radius: 15 } } },
  { question: 30, options: { A: { cx: 590, cy: 610, radius: 15 }, B: { cx: 630, cy: 610, radius: 15 }, C: { cx: 670, cy: 610, radius: 15 }, D: { cx: 710, cy: 610, radius: 15 } } },
    
  // Column 4: Q31–40
  { question: 31, options: { A: { cx: 100, cy: 690, radius: 15 }, B: { cx: 135, cy: 690, radius: 15 }, C: { cx: 170, cy: 690, radius: 15 }, D: { cx: 205, cy: 690, radius: 15 } } },
  { question: 32, options: { A: { cx: 100, cy: 730, radius: 15 }, B: { cx: 135, cy: 730, radius: 15 }, C: { cx: 170, cy: 730, radius: 15 }, D: { cx: 205, cy: 730, radius: 15 } } },
  { question: 33, options: { A: { cx: 100, cy: 770, radius: 15 }, B: { cx: 135, cy: 770, radius: 15 }, C: { cx: 170, cy: 770, radius: 15 }, D: { cx: 205, cy: 770, radius: 15 } } },
  { question: 34, options: { A: { cx: 100, cy: 815, radius: 15 }, B: { cx: 135, cy: 815, radius: 15 }, C: { cx: 170, cy: 815, radius: 15 }, D: { cx: 205, cy: 815, radius: 15 } } },
  { question: 35, options: { A: { cx: 100, cy: 855, radius: 15 }, B: { cx: 135, cy: 855, radius: 15 }, C: { cx: 170, cy: 855, radius: 15 }, D: { cx: 205, cy: 855, radius: 15 } } },
  { question: 36, options: { A: { cx: 100, cy: 895, radius: 15 }, B: { cx: 135, cy: 895, radius: 15 }, C: { cx: 170, cy: 895, radius: 15 }, D: { cx: 205, cy: 895, radius: 15 } } },
  { question: 37, options: { A: { cx: 100, cy: 935, radius: 15 }, B: { cx: 135, cy: 935, radius: 15 }, C: { cx: 170, cy: 935, radius: 15 }, D: { cx: 205, cy: 935, radius: 15 } } },
  { question: 38, options: { A: { cx: 100, cy: 975, radius: 15 }, B: { cx: 135, cy: 975, radius: 15 }, C: { cx: 170, cy: 975, radius: 15 }, D: { cx: 205, cy: 975, radius: 15 } } },
  { question: 39, options: { A: { cx: 100, cy: 1015, radius: 15 }, B: { cx: 135, cy: 1015, radius: 15 }, C: { cx: 170, cy: 1015, radius: 15 }, D: { cx: 205, cy: 1015, radius: 15 } } },
  { question: 40, options: { A: { cx: 100, cy: 1055, radius: 15 }, B: { cx: 135, cy: 1055, radius: 15 }, C: { cx: 170, cy: 1055, radius: 15 }, D: { cx: 205, cy: 1055, radius: 15 } } },

  // Column 5: Q41–50
  { question: 41, options: { A: { cx: 350, cy: 690, radius: 15 }, B: { cx: 385, cy: 690, radius: 15 }, C: { cx: 420, cy: 690, radius: 15 }, D: { cx: 455, cy: 690, radius: 15 } } },
  { question: 42, options: { A: { cx: 350, cy: 730, radius: 15 }, B: { cx: 385, cy: 730, radius: 15 }, C: { cx: 420, cy: 730, radius: 15 }, D: { cx: 455, cy: 730, radius: 15 } } },
  { question: 43, options: { A: { cx: 350, cy: 770, radius: 15 }, B: { cx: 385, cy: 770, radius: 15 }, C: { cx: 420, cy: 770, radius: 15 }, D: { cx: 455, cy: 770, radius: 15 } } },
  { question: 44, options: { A: { cx: 350, cy: 815, radius: 15 }, B: { cx: 385, cy: 815, radius: 15 }, C: { cx: 420, cy: 815, radius: 15 }, D: { cx: 455, cy: 815, radius: 15 } } },
  { question: 45, options: { A: { cx: 350, cy: 855, radius: 15 }, B: { cx: 385, cy: 855, radius: 15 }, C: { cx: 420, cy: 855, radius: 15 }, D: { cx: 455, cy: 855, radius: 15 } } },
  { question: 46, options: { A: { cx: 350, cy: 895, radius: 15 }, B: { cx: 385, cy: 895, radius: 15 }, C: { cx: 420, cy: 895, radius: 15 }, D: { cx: 455, cy: 895, radius: 15 } } },
  { question: 47, options: { A: { cx: 350, cy: 935, radius: 15 }, B: { cx: 385, cy: 935, radius: 15 }, C: { cx: 420, cy: 935, radius: 15 }, D: { cx: 455, cy: 935, radius: 15 } } },
  { question: 48, options: { A: { cx: 350, cy: 975, radius: 15 }, B: { cx: 385, cy: 975, radius: 15 }, C: { cx: 420, cy: 975, radius: 15 }, D: { cx: 455, cy: 975, radius: 15 } } },
  { question: 49, options: { A: { cx: 350, cy: 1015, radius: 15 }, B: { cx: 385, cy: 1015, radius: 15 }, C: { cx: 420, cy: 1015, radius: 15 }, D: { cx: 455, cy: 1015, radius: 15 } } },
  { question: 50, options: { A: { cx: 350, cy: 1055, radius: 15 }, B: { cx: 385, cy: 1055, radius: 15 }, C: { cx: 420, cy: 1055, radius: 15 }, D: { cx: 455, cy: 1055, radius: 15 } } },

  ];
