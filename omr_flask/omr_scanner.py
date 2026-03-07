import math
from typing import Dict, List, Tuple, Optional

import cv2
import numpy as np


# ---- Template: match frontend bubble-template.ts and OpenCvScannerService ----

SHEET_WIDTH = 800
SHEET_HEIGHT = 1131

# Corner marker centers in template coordinates (same as TEMPLATE_MARKERS in OpenCvScannerService)
TEMPLATE_MARKERS = {
    "tl": (42.5, 42.5),
    "tr": (757.5, 42.5),
    "br": (757.5, 1088.5),
    "bl": (42.5, 1088.5),
}


def generate_bubbles(max_questions: int = 50) -> List[Dict]:
    """
    Port of src/app/data/bubble-template.ts generateBubbles()

    Returns a list where each element is:
    {
        "question": int,
        "options": {
            "A": {"cx": float, "cy": float, "radius": float},
            "B": {...},
            "C": {...},
            "D": {...},
        }
    }
    """
    START_Y = 320
    ROW_HEIGHT = 32
    COL1_X = 158
    COL2_X = 518
    BUBBLE_GAP = 48
    RADIUS = 16

    template: List[Dict] = []
    for i in range(1, max_questions + 1):
        is_col2 = i > 25
        row_index = i - 26 if is_col2 else i - 1
        start_x = COL2_X if is_col2 else COL1_X
        cy = START_Y + row_index * ROW_HEIGHT

        template.append(
            {
                "question": i,
                "options": {
                    "A": {"cx": float(start_x), "cy": float(cy), "radius": float(RADIUS)},
                    "B": {
                        "cx": float(start_x + BUBBLE_GAP),
                        "cy": float(cy),
                        "radius": float(RADIUS),
                    },
                    "C": {
                        "cx": float(start_x + 2 * BUBBLE_GAP),
                        "cy": float(cy),
                        "radius": float(RADIUS),
                    },
                    "D": {
                        "cx": float(start_x + 3 * BUBBLE_GAP),
                        "cy": float(cy),
                        "radius": float(RADIUS),
                    },
                },
            }
        )

    return template


BUBBLES_TEMPLATE = generate_bubbles()


# ---- Core helpers ----


def _detect_corners(src: np.ndarray) -> Optional[List[Tuple[float, float]]]:
    """
    Detect TL, TR, BR, BL nested-square markers using an OpenCV pipeline
    equivalent to OpenCvScannerService.detectCorners().
    Returns a list of 4 (x, y) points in that order, or None on failure.
    """
    gray = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    bin_img = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 10
    )

    contours, hierarchy = cv2.findContours(
        bin_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
    )

    h, w = gray.shape
    img_area = w * h
    min_area = img_area * 0.0005
    max_area = img_area * 0.05

    detected: Dict[str, Optional[Dict[str, float]]] = {
        "tl": None,
        "tr": None,
        "br": None,
        "bl": None,
    }

    region_frac = 0.4
    regions = {
        "tl": (0, 0, int(w * region_frac), int(h * region_frac)),
        "tr": (int(w * (1 - region_frac)), 0, w, int(h * region_frac)),
        "bl": (0, int(h * (1 - region_frac)), int(w * region_frac), h),
        "br": (int(w * (1 - region_frac)), int(h * (1 - region_frac)), w, h),
    }

    max_to_process = min(len(contours), 1000)
    for i in range(max_to_process):
        cnt = contours[i]
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        ar = cw / max(1.0, float(ch))
        if ar < 0.7 or ar > 1.35:
            continue

        m = cv2.moments(cnt)
        if m["m00"] == 0:
            continue
        cx = m["m10"] / m["m00"]
        cy = m["m01"] / m["m00"]

        score = 1.0 - abs(1.0 - ar)

        for key in ("tl", "tr", "br", "bl"):
            rx0, ry0, rx1, ry1 = regions[key]
            if rx0 <= cx < rx1 and ry0 <= cy < ry1:
                cur = detected[key]
                if cur is None or score > cur["score"]:
                    detected[key] = {"x": cx, "y": cy, "score": score}

    results: List[Tuple[float, float]] = []
    for key in ("tl", "tr", "br", "bl"):
        val = detected[key]
        if val is None:
            return None
        results.append((val["x"], val["y"]))

    return results


def _warp_perspective(src: np.ndarray, corners: List[Tuple[float, float]]) -> np.ndarray:
    """
    Warp to the template coordinate system using the same mapping as
    OpenCvScannerService.warpPerspective().
    """
    src_pts = np.array(corners, dtype=np.float32)
    dst_pts = np.array(
        [
            TEMPLATE_MARKERS["tl"],
            TEMPLATE_MARKERS["tr"],
            TEMPLATE_MARKERS["br"],
            TEMPLATE_MARKERS["bl"],
        ],
        dtype=np.float32,
    )

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    dst = cv2.warpPerspective(
        src, M, (SHEET_WIDTH, SHEET_HEIGHT), flags=cv2.INTER_LINEAR
    )
    return dst


def _decode_student_code(gray: np.ndarray) -> Optional[int]:
    """
    Decode the 8x8 student code grid from the warped sheet.
    Mirrors OpenCvScannerService.decodeStudentCode().
    """
    origin_x = 320
    origin_y = 150
    cell = 6
    size = 8

    bits: List[int] = []
    for r in range(size):
        for c in range(size):
            if r == 0 or c == 0:
                continue
            px = int(round(origin_x + c * cell + cell / 2))
            py = int(round(origin_y + r * cell + cell / 2))
            if 0 <= px < gray.shape[1] and 0 <= py < gray.shape[0]:
                val = int(gray[py, px])
                bits.append(1 if val < 150 else 0)

    if len(bits) < 48:
        return None

    def read16(offset: int) -> int:
        v = 0
        for i in range(16):
            v = (v << 1) | (1 if bits[offset + i] else 0)
        return v & 0xFFFF

    # Only student part currently used
    student_part = read16(32)
    return student_part


def _mean_in_circle(gray: np.ndarray, cx: float, cy: float, radius: float) -> float:
    h, w = gray.shape
    r_int = int(math.ceil(radius))
    r_sq = radius * radius
    total = 0.0
    count = 0

    for dy in range(-r_int, r_int + 1):
        for dx in range(-r_int, r_int + 1):
            if dx * dx + dy * dy > r_sq:
                continue
            x = int(round(cx + dx))
            y = int(round(cy + dy))
            if 0 <= x < w and 0 <= y < h:
                total += float(gray[y, x])
                count += 1
    return total / count if count > 0 else 255.0


def _mean_in_annulus(
    gray: np.ndarray, cx: float, cy: float, r_in: float, r_out: float
) -> float:
    h, w = gray.shape
    r_int = int(math.ceil(r_out))
    r_in_sq = r_in * r_in
    r_out_sq = r_out * r_out
    total = 0.0
    count = 0

    for dy in range(-r_int, r_int + 1):
        for dx in range(-r_int, r_int + 1):
            d_sq = dx * dx + dy * dy
            if d_sq < r_in_sq or d_sq > r_out_sq:
                continue
            x = int(round(cx + dx))
            y = int(round(cy + dy))
            if 0 <= x < w and 0 <= y < h:
                total += float(gray[y, x])
                count += 1
    return total / count if count > 0 else 255.0


def _bubble_fill_score(gray: np.ndarray, cx: float, cy: float, radius: float) -> float:
    """
    ZipGrade-style bubble scoring; mirrors OpenCvScannerService.bubbleFillScore().
    """
    r = max(8.0, radius)
    inner_radius = round(r * 0.9)
    bg_inner = round(r * 1.05)
    bg_outer = round(r * 1.35)

    inner_mean = _mean_in_circle(gray, cx, cy, inner_radius)
    bg_mean = _mean_in_annulus(gray, cx, cy, bg_inner, bg_outer)

    delta = bg_mean - inner_mean
    score = max(0.0, min(1.0, delta / 255.0))
    return score


def _normalize_key(v: str) -> str:
    s = (v or "").strip().upper()
    return s if s in ("A", "B", "C", "D") else ""


def _grade_bubbles(
    warped: np.ndarray, answer_key: List[str]
) -> Tuple[List[Dict], Dict[str, str]]:
    """
    Grade bubbles on the warped sheet. Returns:
    - grading_results: list per question (questionNumber, detectedAnswer, correctAnswer, status, confidence, rawScores)
    - answers_map: {"1": "A", ...} using detected answers only
    """
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    normalized_key = list(answer_key) if isinstance(answer_key, list) else []
    # Number of questions to process: match TS logic (use key length or default 50, limited by template)
    requested = len(normalized_key)
    n = max(1, min(len(BUBBLES_TEMPLATE), requested or 50))

    per_question: List[Dict] = []

    for q in range(n):
        t = BUBBLES_TEMPLATE[q]
        fills = []
        for opt in ("A", "B", "C", "D"):
            coord = t["options"][opt]
            score = _bubble_fill_score(
                gray, coord["cx"], coord["cy"], coord["radius"]
            )
            fills.append({"opt": opt, "score": float(score)})

        sorted_fills = sorted(fills, key=lambda x: x["score"], reverse=True)
        per_question.append(
            {
                "fills": fills,
                "top": sorted_fills[0],
                "second": sorted_fills[1],
            }
        )

    # Adaptive thresholds based on best-per-question scores
    best_scores = [d["top"]["score"] for d in per_question if d["top"]["score"] > 0.005]
    sorted_scores = sorted(best_scores) if best_scores else []

    q_strong = 0.85
    if sorted_scores:
        idx = min(len(sorted_scores) - 1, max(0, int(math.floor(q_strong * (len(sorted_scores) - 1)))))
        strong = sorted_scores[idx]
    else:
        strong = 0.0

    min_fill = max(0.12, min(0.30, strong * 0.65))
    min_gap = max(0.04, min(0.14, min_fill * 0.5))

    grading_results: List[Dict] = []
    answers_map: Dict[str, str] = {}

    for q in range(n):
        pq = per_question[q]
        fills = pq["fills"]
        top = pq["top"]
        second = pq["second"]
        correct_ans = _normalize_key(normalized_key[q] if q < len(normalized_key) else "")

        if top["score"] < min_fill:
            status = "Blank"
            detected = None
        elif (top["score"] - second["score"]) < min_gap:
            status = "Invalid"
            detected = None
        else:
            detected = top["opt"]
            if not correct_ans:
                status = "Invalid"
            else:
                status = "Correct" if detected == correct_ans else "Incorrect"

        raw_scores = {f["opt"]: f["score"] for f in fills}

        grading_results.append(
            {
                "questionNumber": q + 1,
                "detectedAnswer": detected,
                "correctAnswer": correct_ans,
                "status": status,
                "confidence": float(top["score"]),
                "rawScores": raw_scores,
            }
        )

        if detected:
            answers_map[str(q + 1)] = detected

    return grading_results, answers_map


def build_answer_key_from_map(key_map: Dict[str, str]) -> List[str]:
    """
    Convert an answer key in the form {"1": "B", "2": "C", ...}
    into a list ['B', 'C', ...] indexed from 0.
    """
    if not key_map:
        return []
    max_q = max(int(k) for k in key_map.keys() if str(k).isdigit())
    key_list: List[str] = []
    for q in range(1, max_q + 1):
        key_list.append(key_map.get(str(q), ""))
    return key_list


def process_image(
    image_bgr: np.ndarray, answer_key_list: List[str]
) -> Dict:
    """
    Top-level OMR pipeline for a single sheet image in BGR format.
    Returns a result dict containing grading_results, answers_map, counts, etc.
    """
    if image_bgr is None or image_bgr.size == 0:
        raise ValueError("Empty image")

    # 1) Detect corners
    corners = _detect_corners(image_bgr)
    if not corners or len(corners) != 4:
        raise RuntimeError(
            "Could not detect all 4 corner markers. Align the sheet within the frame."
        )

    # 2) Warp to template coordinates
    warped = _warp_perspective(image_bgr, corners)

    # 3) Optionally decode student hash (not used in JSON score, but returned)
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    student_hash = _decode_student_code(gray)

    # 4) Grade bubbles
    grading_results, answers_map = _grade_bubbles(warped, answer_key_list)

    total_questions = len(grading_results)
    correct = sum(1 for r in grading_results if r["status"] == "Correct")
    wrong = total_questions - correct  # includes Blank + Invalid as wrong
    score_percent = int(round((correct / total_questions) * 100)) if total_questions > 0 else 0

    return {
        "gradingResults": grading_results,
        "answers": answers_map,
        "correct": correct,
        "wrong": wrong,
        "score": score_percent,
        "total": total_questions,
        "studentHash": int(student_hash) if student_hash is not None else None,
    }

