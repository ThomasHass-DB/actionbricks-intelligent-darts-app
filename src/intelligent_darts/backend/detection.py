"""Dart detection, calibration transform, and dartboard scoring."""

from __future__ import annotations

import base64
import json
import math
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .logger import logger
from .models import (
    DetectedDartOut,
    DetectionBoxOut,
    DetectionCameraOut,
    DetectionOut,
    DetectionPointOut,
)

if TYPE_CHECKING:
    import numpy as np
    from databricks.sdk import WorkspaceClient
    from ultralytics import YOLO

# ── Board geometry (mirrors dartboard-geometry.ts) ───────────────────────────

BOARD_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
SEG_DEG = 360 / 20  # 18° per segment

RADII = {
    "innerBull": 6.35,
    "outerBull": 15.9,
    "tripleInner": 97,
    "tripleOuter": 107,
    "doubleInner": 160,
    "doubleOuter": 170,
}


# ── Scoring ──────────────────────────────────────────────────────────────────

def _angle_from_12_cw(x: float, y: float) -> float:
    """Angle in degrees clockwise from 12-o'clock for a point in board-mm coords."""
    angle = math.degrees(math.atan2(x, -y))
    if angle < 0:
        angle += 360
    return angle


def _segment_number(angle_deg: float) -> int:
    """Return the board number for a given CW-from-12 angle."""
    idx = int((angle_deg + SEG_DEG / 2) % 360 / SEG_DEG)
    return BOARD_NUMBERS[idx]


def score_from_board_coords(bx: float, by: float) -> tuple[int, str, str]:
    """Score a dart given its position in perfect-board mm coords.

    Returns (value, label, segment_id).
    """
    r = math.sqrt(bx * bx + by * by)

    if r <= RADII["innerBull"]:
        return 50, "D-BULL", "inner-bull"
    if r <= RADII["outerBull"]:
        return 25, "BULL", "outer-bull"
    if r > RADII["doubleOuter"]:
        return 0, "MISS", "miss"

    angle = _angle_from_12_cw(bx, by)
    num = _segment_number(angle)

    if RADII["tripleInner"] <= r <= RADII["tripleOuter"]:
        return num * 3, f"T{num}", f"t-{num}"
    if RADII["doubleInner"] <= r <= RADII["doubleOuter"]:
        return num * 2, f"D{num}", f"d-{num}"
    if r < RADII["tripleInner"]:
        return num, str(num), f"is-{num}"
    return num, str(num), f"os-{num}"


# ── Calibration transform ───────────────────────────────────────────────────

def _apply_homography(matrix: list[list[float]], x: float, y: float) -> tuple[float, float]:
    """Apply a 3×3 homography matrix to a point (camera px → board mm)."""
    m = matrix
    w = m[2][0] * x + m[2][1] * y + m[2][2]
    if abs(w) < 1e-14:
        raise ValueError("Degenerate homography transform")
    u = (m[0][0] * x + m[0][1] * y + m[0][2]) / w
    v = (m[1][0] * x + m[1][1] * y + m[1][2]) / w
    return u, v


# ── Model inference ──────────────────────────────────────────────────────────

def load_model(model_path: Path) -> YOLO:
    """Load the YOLO model from disk."""
    from ultralytics import YOLO as _YOLO

    logger.info(f"Loading YOLO model from {model_path}")
    model = _YOLO(str(model_path))
    logger.info("YOLO model loaded successfully")
    return model


def _run_inference(model: YOLO, image_bytes: bytes) -> tuple[list[dict], int, int]:
    """Run YOLO inference on a single image.

    Returns (detections, image_width, image_height).
    Each detection dict has keys:
      confidence, tip_x, tip_y, tail_x, tail_y, tail_visible, bbox
    """
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return [], 0, 0

    img_h, img_w = img.shape[:2]
    results = model(img, verbose=False)
    detections = []

    for result in results:
        logger.debug(f"  YOLO result: boxes={result.boxes is not None}, keypoints={result.keypoints is not None}")
        if result.keypoints is None:
            logger.debug("  Skipping result: no keypoints")
            continue

        # .data is a tensor of shape (N, K, 3)
        kpts_tensor = result.keypoints.data
        if hasattr(kpts_tensor, "cpu"):
            kpts_tensor = kpts_tensor.cpu()
        kpts_np = np.array(kpts_tensor)

        if kpts_np.ndim == 2:
            kpts_np = kpts_np[np.newaxis, ...]

        # Bounding boxes (xyxy)
        boxes_xyxy = None
        if result.boxes is not None and result.boxes.xyxy is not None:
            boxes_tensor = result.boxes.xyxy
            if hasattr(boxes_tensor, "cpu"):
                boxes_tensor = boxes_tensor.cpu()
            boxes_xyxy = np.array(boxes_tensor)

        confs = result.boxes.conf if result.boxes is not None else None
        n_detections = kpts_np.shape[0]
        n_keypoints = kpts_np.shape[1] if kpts_np.ndim >= 2 else 0

        for i in range(n_detections):
            kp = kpts_np[i]  # shape (K, 3)

            if n_keypoints < 1:
                continue

            det: dict = {}

            # Tip (keypoint 0)
            tip_x, tip_y, tip_conf = float(kp[0, 0]), float(kp[0, 1]), float(kp[0, 2])
            if tip_conf > 0.1:
                det["tip_x"] = tip_x
                det["tip_y"] = tip_y
            else:
                continue

            # Tail (keypoint 1, optional)
            if n_keypoints >= 2:
                tail_x, tail_y, tail_conf = float(kp[1, 0]), float(kp[1, 1]), float(kp[1, 2])
                if tail_conf > 0.1:
                    det["tail_x"] = tail_x
                    det["tail_y"] = tail_y
                    det["tail_visible"] = True
                else:
                    det["tail_visible"] = False
            else:
                det["tail_visible"] = False

            # Bounding box
            if boxes_xyxy is not None and i < len(boxes_xyxy):
                det["bbox"] = {
                    "x1": float(boxes_xyxy[i, 0]),
                    "y1": float(boxes_xyxy[i, 1]),
                    "x2": float(boxes_xyxy[i, 2]),
                    "y2": float(boxes_xyxy[i, 3]),
                }

            # Box confidence
            if confs is not None and i < len(confs):
                conf_val = confs[i]
                if hasattr(conf_val, "cpu"):
                    conf_val = conf_val.cpu()
                det["confidence"] = float(np.array(conf_val))
            else:
                det["confidence"] = tip_conf

            detections.append(det)

    return detections, img_w, img_h


# ── Remote inference via Model Serving ───────────────────────────────────────


def _run_inference_remote(
    ws: WorkspaceClient,
    endpoint_name: str,
    image_bytes: bytes,
) -> tuple[list[dict], int, int]:
    """Run inference via a Databricks Model Serving endpoint.

    The endpoint is expected to accept base64-encoded JPEG images and return
    structured JSON with detections (keypoints, bbox, confidence) and image dims.

    Returns (detections, image_width, image_height) — same shape as _run_inference.
    """
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    response = ws.serving_endpoints.query(
        name=endpoint_name,
        inputs=[b64_image],
    )

    predictions: Any = response.predictions
    if not predictions:
        logger.warning(f"[remote] Empty predictions from endpoint {endpoint_name}")
        return [], 0, 0

    # The wrapper returns one result dict per input image
    result = predictions[0] if isinstance(predictions, list) else predictions

    img_w = int(result.get("image_width", 0))
    img_h = int(result.get("image_height", 0))
    detections: list[dict] = []

    for det in result.get("detections", []):
        kpts = det.get("keypoints", [])
        parsed: dict = {}

        # Tip (keypoint 0)
        if len(kpts) < 1:
            continue
        tip_x, tip_y, tip_conf = float(kpts[0][0]), float(kpts[0][1]), float(kpts[0][2])
        if tip_conf <= 0.1:
            continue
        parsed["tip_x"] = tip_x
        parsed["tip_y"] = tip_y

        # Tail (keypoint 1, optional)
        if len(kpts) >= 2:
            tail_x, tail_y, tail_conf = float(kpts[1][0]), float(kpts[1][1]), float(kpts[1][2])
            if tail_conf > 0.1:
                parsed["tail_x"] = tail_x
                parsed["tail_y"] = tail_y
                parsed["tail_visible"] = True
            else:
                parsed["tail_visible"] = False
        else:
            parsed["tail_visible"] = False

        # Bounding box
        bbox = det.get("bbox")
        if bbox and len(bbox) == 4:
            parsed["bbox"] = {
                "x1": float(bbox[0]),
                "y1": float(bbox[1]),
                "x2": float(bbox[2]),
                "y2": float(bbox[3]),
            }

        parsed["confidence"] = det.get("confidence", tip_conf)
        detections.append(parsed)

    logger.info(
        f"[remote] Endpoint {endpoint_name}: {len(detections)} detections, "
        f"image {img_w}x{img_h}"
    )
    return detections, img_w, img_h


# ── Per-camera detection pipeline ────────────────────────────────────────────

def _detect_for_camera(
    cam_id: int,
    image_bytes: bytes,
    calibration_json: str | None,
    *,
    model: YOLO | None = None,
    ws: WorkspaceClient | None = None,
    endpoint_name: str | None = None,
) -> DetectionCameraOut:
    """Run detection + scoring for ALL darts in a single camera image."""
    logger.info(f"[cam{cam_id}] Image size: {len(image_bytes)} bytes, calibration: {'yes' if calibration_json else 'no'}")

    if ws is not None and endpoint_name is not None:
        raw_detections, img_w, img_h = _run_inference_remote(ws, endpoint_name, image_bytes)
    elif model is not None:
        raw_detections, img_w, img_h = _run_inference(model, image_bytes)
    else:
        raise ValueError("Either model or (ws, endpoint_name) must be provided")
    logger.info(f"[cam{cam_id}] Image decoded as {img_w}x{img_h}, raw detections: {len(raw_detections)}")

    cam_result = DetectionCameraOut(
        cam_id=cam_id,
        image_width=img_w if img_w > 0 else None,
        image_height=img_h if img_h > 0 else None,
    )

    if not raw_detections:
        logger.info(f"[cam{cam_id}] No raw detections from model")
        return cam_result

    # Parse calibration matrix once
    matrix = None
    if calibration_json:
        try:
            matrix = json.loads(calibration_json)
        except Exception as e:
            logger.warning(f"Failed to parse calibration for cam{cam_id}: {e}")

    for det in raw_detections:
        tip_x = det.get("tip_x")
        tip_y = det.get("tip_y")
        if tip_x is None or tip_y is None:
            continue

        dart = DetectedDartOut(
            tip=DetectionPointOut(x=tip_x, y=tip_y),
            confidence=det.get("confidence"),
        )

        if det.get("tail_visible") and "tail_x" in det:
            dart.tail = DetectionPointOut(x=det["tail_x"], y=det["tail_y"])

        if "bbox" in det:
            dart.bbox = DetectionBoxOut(**det["bbox"])

        # Apply calibration and score
        if matrix is not None:
            try:
                bx, by = _apply_homography(matrix, tip_x, tip_y)
                dart.board_x = bx
                dart.board_y = by
                value, label, seg_id = score_from_board_coords(bx, by)
                dart.score_value = value
                dart.score_label = label
                dart.segment_id = seg_id
            except Exception as e:
                logger.warning(f"Calibration transform failed for cam{cam_id}: {e}")

        cam_result.darts.append(dart)
        logger.info(f"[cam{cam_id}] Dart: tip=({tip_x:.1f},{tip_y:.1f}), conf={dart.confidence:.3f}, score={dart.score_label}, board=({dart.board_x}, {dart.board_y})")

    logger.info(f"[cam{cam_id}] Total darts found: {len(cam_result.darts)}")
    return cam_result


# ── Full detection pipeline (all 3 cameras) ─────────────────────────────────

# Distance threshold (in board mm) to consider two detections as the same
# physical dart seen from different cameras.
_DEDUP_RADIUS_MM = 25.0


def _deduplicate_by_board_position(
    candidates: list[tuple[DetectedDartOut, int]],
) -> list[tuple[DetectedDartOut, int]]:
    """Cluster darts by board-mm position and keep the highest-confidence one per cluster.

    Each candidate is (dart, cam_id). Darts without board coords are kept as-is.
    """
    used = [False] * len(candidates)
    result: list[tuple[DetectedDartOut, int]] = []

    # Sort by confidence descending so the best dart wins each cluster
    order = sorted(range(len(candidates)), key=lambda i: candidates[i][0].confidence or 0, reverse=True)

    for i in order:
        if used[i]:
            continue
        dart_i, cam_i = candidates[i]
        used[i] = True
        result.append((dart_i, cam_i))

        # Mark any lower-confidence dart within dedup radius as duplicate
        if dart_i.board_x is not None and dart_i.board_y is not None:
            for j in order:
                if used[j]:
                    continue
                dart_j, _ = candidates[j]
                if dart_j.board_x is None or dart_j.board_y is None:
                    continue
                dx = dart_i.board_x - dart_j.board_x
                dy = dart_i.board_y - dart_j.board_y
                dist = math.sqrt(dx * dx + dy * dy)
                if dist < _DEDUP_RADIUS_MM:
                    used[j] = True  # duplicate — skip the lower-confidence one

    return result


def run_detection(
    images: list[tuple[int, bytes]],
    calibrations: list[tuple[int, str | None]],
    *,
    model: YOLO | None = None,
    ws: WorkspaceClient | None = None,
    endpoint_name: str | None = None,
) -> DetectionOut:
    """Run detection on all cameras, pick the best darts by confidence.

    Either ``model`` (local YOLO) **or** ``ws`` + ``endpoint_name`` (remote
    Databricks Model Serving) must be provided.

    Strategy:
      1. Run inference on all cameras.
      2. Pool all scored (calibrated) darts from every camera.
      3. Deduplicate: if the same physical dart is seen from multiple cameras,
         keep only the highest-confidence detection.
      4. Sort remaining darts by confidence and return the top ones.
      5. The "chosen_cam_id" is set to the camera that contributed the most darts.
    """
    cal_map = {cam_id: cal for cam_id, cal in calibrations}
    camera_results: list[DetectionCameraOut] = []

    for cam_id, img_bytes in images:
        cal = cal_map.get(cam_id)
        cam_result = _detect_for_camera(
            cam_id, img_bytes, cal,
            model=model, ws=ws, endpoint_name=endpoint_name,
        )
        camera_results.append(cam_result)

    # Pool all scored darts from every camera
    all_candidates: list[tuple[DetectedDartOut, int]] = []
    for cam in camera_results:
        for dart in cam.darts:
            if dart.score_value is not None:
                all_candidates.append((dart, cam.cam_id))

    if not all_candidates:
        # Fallback: no scored darts at all — pick camera with most raw detections
        fallback_cam: DetectionCameraOut | None = None
        best_count = 0
        for cam in camera_results:
            if len(cam.darts) > best_count:
                best_count = len(cam.darts)
                fallback_cam = cam
        result = DetectionOut(
            chosen_cam_id=fallback_cam.cam_id if fallback_cam else None,
            darts=fallback_cam.darts if fallback_cam else [],
            cameras=camera_results,
        )
        total_raw = sum(len(c.darts) for c in camera_results)
        logger.info(f"[detection] No scored darts. Raw total: {total_raw}, fallback_cam: {result.chosen_cam_id}")
        return result

    # Deduplicate across cameras by board position, keeping highest confidence
    deduped = _deduplicate_by_board_position(all_candidates)

    # Sort by confidence descending
    deduped.sort(key=lambda x: x[0].confidence or 0, reverse=True)

    best_darts = [d for d, _ in deduped]
    cam_ids = [c for _, c in deduped]

    # Determine "chosen cam" as the one contributing the most darts
    from collections import Counter
    cam_counts = Counter(cam_ids)
    chosen_cam_id = cam_counts.most_common(1)[0][0] if cam_counts else None

    for dart, cam_id in deduped:
        logger.info(
            f"[detection] Final dart: cam{cam_id}, conf={dart.confidence:.3f}, "
            f"score={dart.score_label}, board=({dart.board_x:.1f},{dart.board_y:.1f})"
        )

    result = DetectionOut(
        chosen_cam_id=chosen_cam_id,
        darts=best_darts,
        cameras=camera_results,
    )
    total_raw = sum(len(c.darts) for c in camera_results)
    logger.info(
        f"[detection] Total raw: {total_raw}, pooled scored: {len(all_candidates)}, "
        f"after dedup: {len(deduped)}, chosen_cam: {chosen_cam_id}"
    )
    return result
