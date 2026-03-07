import json
from typing import Dict, Any

import cv2
import numpy as np
from flask import Flask, request, jsonify

from .omr_scanner import process_image, build_answer_key_from_map


app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health() -> Any:
    return jsonify({"status": "ok"}), 200


@app.route("/scan-exam", methods=["POST"])
def scan_exam() -> Any:
    """
    POST /scan-exam

    Accepts:
    - multipart/form-data:
        - file: image file (JPEG/PNG)
        - answer_key: JSON object as string, e.g. '{"1": "B", "2": "C"}'
      OR
    - application/json:
        {
          "image_base64": "data:image/jpeg;base64,...",
          "answer_key": { "1": "B", "2": "C", ... }
        }

    Returns JSON:
    {
      "answers": { "1": "B", "2": "D", ... },
      "correct": 4,
      "wrong": 1,
      "score": 80,
      "total": 5,
      "details": [ ... per-question gradingResults ... ],
      "studentHash": 12345 | null
    }
    """
    try:
        img_bgr = None
        answer_key_map: Dict[str, str] = {}

        # --- Multipart form: file upload from Ionic/Angular ---
        if request.content_type and "multipart/form-data" in request.content_type:
            file = request.files.get("file") or request.files.get("image")
            if not file:
                return jsonify({"error": "No image file provided (expected 'file' or 'image')."}), 400

            # Decode image bytes with OpenCV
            file_bytes = np.frombuffer(file.read(), np.uint8)
            img_bgr = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
            if img_bgr is None:
                return jsonify({"error": "Could not decode image."}), 400

            raw_key = request.form.get("answer_key") or request.form.get("answerKey")
            if raw_key:
                try:
                    answer_key_map = json.loads(raw_key)
                except json.JSONDecodeError:
                    return jsonify({"error": "answer_key must be valid JSON."}), 400

        # --- JSON: optional base64 image payload ---
        elif request.is_json:
            payload = request.get_json(silent=True) or {}
            answer_key_map = payload.get("answer_key") or payload.get("answerKey") or {}

            image_b64 = payload.get("image_base64") or payload.get("imageBase64")
            if not image_b64:
                return jsonify({"error": "image_base64 is required in JSON payload."}), 400

            try:
                import base64

                # Support data URLs (strip prefix "data:image/jpeg;base64,")
                if "," in image_b64:
                    image_b64 = image_b64.split(",", 1)[1]
                img_bytes = base64.b64decode(image_b64)
                file_bytes = np.frombuffer(img_bytes, np.uint8)
                img_bgr = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
                if img_bgr is None:
                    return jsonify({"error": "Could not decode base64 image."}), 400
            except Exception as exc:  # noqa: BLE001
                return jsonify({"error": f"Failed to decode base64 image: {exc}"}), 400

        else:
            return jsonify({"error": "Unsupported Content-Type. Use multipart/form-data or application/json."}), 415

        # Build answer key list for grading
        if not isinstance(answer_key_map, dict):
            return jsonify({"error": "answer_key must be an object/map of {\"1\": \"B\", ...}."}), 400

        answer_key_list = build_answer_key_from_map(answer_key_map)

        # Run OMR pipeline
        result = process_image(img_bgr, answer_key_list)

        response = {
            "answers": result["answers"],
            "correct": result["correct"],
            "wrong": result["wrong"],
            "score": result["score"],
            "total": result["total"],
            "details": result["gradingResults"],
            "studentHash": result["studentHash"],
        }
        return jsonify(response), 200

    except Exception as exc:  # noqa: BLE001
        # Generic failure
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    # Run with: python -m omr_flask.app
    app.run(host="0.0.0.0", port=5000, debug=True)

