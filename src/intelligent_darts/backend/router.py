from __future__ import annotations

import hashlib
import io
import re
import shutil
import zipfile
from collections import defaultdict
from typing import Annotated

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.iam import User as UserOut
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .._metadata import api_prefix
from .dependencies import ConfigDep, RuntimeDep, get_obo_ws
from .models import (
    CalibrationDataIn,
    CalibrationDataOut,
    CalibrationSetIn,
    CalibrationSetListOut,
    CalibrationSetOut,
    CalibrationSlotOut,
    CameraSettingsIn,
    CameraSettingsOut,
    CreateCaptureOut,
    DatasetStatsOut,
    DeleteCaptureOut,
    DetectionOut,
    RawCaptureGroupOut,
    RawCaptureListOut,
    SaveLabelsIn,
    SaveLabelsOut,
    VersionOut,
)

api = APIRouter(prefix=api_prefix)


@api.get("/version", response_model=VersionOut, operation_id="version")
async def version():
    return VersionOut.from_metadata()


@api.get("/current-user", response_model=UserOut, operation_id="currentUser")
def me(obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)]):
    return obo_ws.current_user.me()


# ── Camera settings ──────────────────────────────────────────────────────────


@api.get(
    "/camera-settings",
    response_model=CameraSettingsOut,
    operation_id="getCameraSettings",
)
async def get_camera_settings(runtime: RuntimeDep):
    return runtime.camera_settings


@api.put(
    "/camera-settings",
    response_model=CameraSettingsOut,
    operation_id="updateCameraSettings",
)
async def update_camera_settings(settings: CameraSettingsIn, runtime: RuntimeDep):
    runtime.camera_settings = CameraSettingsOut(**settings.model_dump())
    return runtime.camera_settings


# ── Kinesis WebRTC viewer config ─────────────────────────────────────────────

from .kinesis_webrtc import ViewerConnectionInfo


@api.get(
    "/kinesis/viewer-config",
    response_model=ViewerConnectionInfo,
    operation_id="getKinesisViewerConfig",
)
async def get_kinesis_viewer_config(
    channel_name: str,
    runtime: RuntimeDep,
) -> ViewerConnectionInfo:
    """Return WebRTC viewer connection info for a Kinesis signaling channel.

    The browser uses this to establish a peer connection as a viewer.
    """
    from fastapi import HTTPException

    from .kinesis_webrtc import get_viewer_connection_info

    settings = runtime.camera_settings
    if not channel_name.strip():
        raise HTTPException(status_code=400, detail="channel_name is required")

    try:
        return get_viewer_connection_info(
            channel_name=channel_name.strip(),
            region=settings.region,
            service_credential_name=settings.service_credential_name or None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        import traceback

        from .logger import logger as _logger

        _logger.error(
            f"Kinesis viewer-config error for channel '{channel_name}': "
            f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"Failed to get viewer config for channel '{channel_name}': {exc}",
        )


# ── Calibration persistence ───────────────────────────────────────────────────

import json as _json


@api.get(
    "/calibration",
    response_model=CalibrationDataOut,
    operation_id="getCalibration",
)
async def get_calibration(config: ConfigDep) -> CalibrationDataOut:
    """Load saved calibration data from disk."""
    path = config.calibration_file_path
    if path.exists():
        try:
            data = _json.loads(path.read_text())
            return CalibrationDataOut(**data)
        except Exception:
            pass
    return CalibrationDataOut(slots=[])


@api.put(
    "/calibration",
    response_model=CalibrationDataOut,
    operation_id="saveCalibration",
)
async def save_calibration(body: CalibrationDataIn, config: ConfigDep) -> CalibrationDataOut:
    """Persist calibration data to disk."""
    path = config.calibration_file_path
    # Ensure exactly 3 slots
    slots = body.slots[:3]
    while len(slots) < 3:
        from .models import CalibrationSlotIn

        slots.append(CalibrationSlotIn())

    out = CalibrationDataOut(
        slots=[CalibrationSlotOut(**s.model_dump()) for s in slots]
    )
    path.write_text(_json.dumps(out.model_dump(), indent=2))
    return out


# ── Named calibration sets ───────────────────────────────────────────────

from datetime import datetime, timezone


def _load_calibration_sets(config: ConfigDep) -> list[dict]:
    path = config.calibration_sets_file_path
    if path.exists():
        try:
            return _json.loads(path.read_text())
        except Exception:
            pass
    return []


def _save_calibration_sets(config: ConfigDep, sets: list[dict]) -> None:
    config.calibration_sets_file_path.write_text(_json.dumps(sets, indent=2))


@api.get(
    "/calibration/sets",
    response_model=CalibrationSetListOut,
    operation_id="listCalibrationSets",
)
async def list_calibration_sets(config: ConfigDep) -> CalibrationSetListOut:
    """List all saved calibration sets."""
    raw = _load_calibration_sets(config)
    sets = [CalibrationSetOut(**s) for s in raw]
    return CalibrationSetListOut(sets=sets)


@api.post(
    "/calibration/sets",
    response_model=CalibrationSetOut,
    operation_id="saveCalibrationSet",
)
async def save_calibration_set(body: CalibrationSetIn, config: ConfigDep) -> CalibrationSetOut:
    """Save a named calibration set. Overwrites if the name already exists."""
    slots = body.slots[:3]
    while len(slots) < 3:
        from .models import CalibrationSlotIn
        slots.append(CalibrationSlotIn())

    out = CalibrationSetOut(
        name=body.name.strip(),
        slots=[CalibrationSlotOut(**s.model_dump()) for s in slots],
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    existing = _load_calibration_sets(config)
    existing = [s for s in existing if s.get("name") != out.name]
    existing.append(out.model_dump())
    _save_calibration_sets(config, existing)
    return out


@api.delete(
    "/calibration/sets/{set_name}",
    response_model=CalibrationSetListOut,
    operation_id="deleteCalibrationSet",
)
async def delete_calibration_set(set_name: str, config: ConfigDep) -> CalibrationSetListOut:
    """Delete a named calibration set."""
    existing = _load_calibration_sets(config)
    existing = [s for s in existing if s.get("name") != set_name]
    _save_calibration_sets(config, existing)
    return CalibrationSetListOut(sets=[CalibrationSetOut(**s) for s in existing])


# ── Data collection / labeling ───────────────────────────────────────────────

_CAPTURE_RE = re.compile(r"^dart_(.+)_cam(\d+)\.jpg$")


def _ensure_dirs(config: ConfigDep) -> None:
    """Create dataset directories if they don't exist."""
    for d in [
        config.raw_captures_dir,
        config.yolo_images_train,
        config.yolo_images_val,
        config.yolo_labels_train,
        config.yolo_labels_val,
    ]:
        d.mkdir(parents=True, exist_ok=True)


def _ensure_data_yaml(config: ConfigDep) -> None:
    """Write data.yaml if it doesn't exist yet."""
    config.dataset_root.mkdir(parents=True, exist_ok=True)
    if not config.data_yaml_path.exists():
        config.data_yaml_path.write_text(
            "path: ../datasets/darts\n"
            "train: images/train\n"
            "val: images/val\n"
            "nc: 1\n"
            "names: [dart]\n"
            "kpt_shape: [2, 3]  # 2 keypoints (tip, tail), each with (x, y, visibility)\n"
        )


def _split_for_capture(capture_id: str) -> str:
    """Deterministic 90/10 train/val split based on capture_id hash."""
    h = int(hashlib.md5(capture_id.encode()).hexdigest(), 16)
    return "val" if (h % 10) == 0 else "train"


@api.post(
    "/raw-captures",
    response_model=CreateCaptureOut,
    operation_id="createRawCapture",
)
async def create_raw_capture(
    config: ConfigDep,
    timestamp: Annotated[str, Form()],
    cam1: Annotated[UploadFile, File()],
    cam2: Annotated[UploadFile, File()],
    cam3: Annotated[UploadFile, File()],
) -> CreateCaptureOut:
    """Save snapshot images from all 3 cameras."""
    _ensure_dirs(config)
    filenames: list[str] = []
    for idx, upload in enumerate([cam1, cam2, cam3], start=1):
        fname = f"dart_{timestamp}_cam{idx}.jpg"
        dest = config.raw_captures_dir / fname
        data = await upload.read()
        dest.write_bytes(data)
        filenames.append(fname)
    return CreateCaptureOut(capture_id=timestamp, filenames=filenames)


@api.get(
    "/raw-captures",
    response_model=RawCaptureListOut,
    operation_id="listRawCaptures",
)
async def list_raw_captures(config: ConfigDep) -> RawCaptureListOut:
    """List all capture groups, newest first."""
    _ensure_dirs(config)
    groups: dict[str, list[str]] = defaultdict(list)
    for f in sorted(config.raw_captures_dir.iterdir()):
        m = _CAPTURE_RE.match(f.name)
        if m:
            groups[m.group(1)].append(f.name)

    # Build a set of filenames that have labels (across train+val)
    labeled_files: set[str] = set()
    for d in [config.yolo_labels_train, config.yolo_labels_val]:
        if d.exists():
            for lf in d.iterdir():
                if lf.suffix == ".txt":
                    labeled_files.add(lf.stem)  # e.g. "dart_20240101_120000_cam1"

    captures = []
    for ts, fnames in sorted(groups.items(), reverse=True):
        lbl_count = sum(1 for fn in fnames if fn.rsplit(".", 1)[0] in labeled_files)
        captures.append(
            RawCaptureGroupOut(
                capture_id=ts,
                timestamp=ts,
                filenames=sorted(fnames),
                labeled_count=lbl_count,
            )
        )
    return RawCaptureListOut(captures=captures, total=len(captures))


@api.get(
    "/raw-captures/{capture_id}/cam/{cam_id}",
    operation_id="getRawCaptureImage",
    responses={200: {"content": {"image/jpeg": {}}}},
)
async def get_raw_capture_image(capture_id: str, cam_id: int, config: ConfigDep):
    """Serve a single capture image."""
    fname = f"dart_{capture_id}_cam{cam_id}.jpg"
    path = config.raw_captures_dir / fname
    if not path.exists():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Image not found: {fname}")
    return FileResponse(path, media_type="image/jpeg")


@api.delete(
    "/raw-captures/{capture_id}",
    response_model=DeleteCaptureOut,
    operation_id="deleteRawCapture",
)
async def delete_raw_capture(capture_id: str, config: ConfigDep) -> DeleteCaptureOut:
    """Delete all images (and any YOLO labels) for a capture group."""
    deleted = 0
    # Delete raw capture files
    for cam in range(1, 4):
        fname = f"dart_{capture_id}_cam{cam}.jpg"
        raw = config.raw_captures_dir / fname
        if raw.exists():
            raw.unlink()
            deleted += 1
        # Also remove from YOLO dataset if it was labeled
        lbl_name = fname.replace(".jpg", ".txt")
        for d in [
            config.yolo_images_train,
            config.yolo_images_val,
            config.yolo_labels_train,
            config.yolo_labels_val,
        ]:
            p = d / fname
            if p.exists():
                p.unlink()
                deleted += 1
            lp = d / lbl_name
            if lp.exists():
                lp.unlink()
                deleted += 1

    if deleted == 0:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Capture not found: {capture_id}")

    return DeleteCaptureOut(capture_id=capture_id, deleted_files=deleted)


@api.put(
    "/labels",
    response_model=SaveLabelsOut,
    operation_id="saveYoloLabels",
)
async def save_yolo_labels(body: SaveLabelsIn, config: ConfigDep) -> SaveLabelsOut:
    """Generate YOLO-Pose label file and copy image to dataset split."""
    _ensure_dirs(config)
    _ensure_data_yaml(config)

    # Parse capture_id from filename: dart_<TIMESTAMP>_cam<N>.jpg
    m = _CAPTURE_RE.match(body.image_filename)
    if not m:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail=f"Invalid filename format: {body.image_filename}",
        )

    capture_id = m.group(1)
    split = _split_for_capture(capture_id)

    # Choose directories based on split
    img_dir = config.yolo_images_train if split == "train" else config.yolo_images_val
    lbl_dir = config.yolo_labels_train if split == "train" else config.yolo_labels_val

    # Copy raw image into YOLO images dir
    src_img = config.raw_captures_dir / body.image_filename
    if src_img.exists():
        shutil.copy2(src_img, img_dir / body.image_filename)

    # Generate YOLO label lines
    w, h = body.image_width, body.image_height
    lines: list[str] = []
    for dart in body.darts:
        tip_x_norm = dart.tip.x / w
        tip_y_norm = dart.tip.y / h

        if dart.tail_visible:
            tail_x_norm = dart.tail.x / w
            tail_y_norm = dart.tail.y / h
            tail_vis = 2

            # BBox heuristic: surround tip & tail with 5% padding
            min_x = min(dart.tip.x, dart.tail.x)
            max_x = max(dart.tip.x, dart.tail.x)
            min_y = min(dart.tip.y, dart.tail.y)
            max_y = max(dart.tip.y, dart.tail.y)
            span = max(max_x - min_x, max_y - min_y)
            pad = 0.05 * span if span > 0 else 10.0
        else:
            # Tail not visible — YOLO visibility 0, coords at 0
            tail_x_norm = 0.0
            tail_y_norm = 0.0
            tail_vis = 0

            # BBox: just the tip with a fixed 20px padding
            min_x = dart.tip.x
            max_x = dart.tip.x
            min_y = dart.tip.y
            max_y = dart.tip.y
            pad = 20.0

        min_x = max(0, min_x - pad)
        max_x = min(w, max_x + pad)
        min_y = max(0, min_y - pad)
        max_y = min(h, max_y + pad)

        cx = ((min_x + max_x) / 2) / w
        cy = ((min_y + max_y) / 2) / h
        bw = (max_x - min_x) / w
        bh = (max_y - min_y) / h

        # class_id cx cy w h tip_x tip_y tip_vis tail_x tail_y tail_vis
        lines.append(
            f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f} "
            f"{tip_x_norm:.6f} {tip_y_norm:.6f} 2 "
            f"{tail_x_norm:.6f} {tail_y_norm:.6f} {tail_vis}"
        )

    label_filename = body.image_filename.replace(".jpg", ".txt")
    label_path = lbl_dir / label_filename
    label_path.write_text("\n".join(lines) + "\n" if lines else "")

    return SaveLabelsOut(
        label_path=str(label_path),
        split=split,
        num_darts=len(body.darts),
    )


@api.get(
    "/dataset/stats",
    response_model=DatasetStatsOut,
    operation_id="getDatasetStats",
)
async def get_dataset_stats(config: ConfigDep) -> DatasetStatsOut:
    """Return dataset statistics."""
    _ensure_dirs(config)

    # Count raw captures (groups)
    groups: set[str] = set()
    for f in config.raw_captures_dir.iterdir():
        m = _CAPTURE_RE.match(f.name)
        if m:
            groups.add(m.group(1))

    train_imgs = len(list(config.yolo_images_train.glob("*.jpg")))
    val_imgs = len(list(config.yolo_images_val.glob("*.jpg")))
    train_labels = len(list(config.yolo_labels_train.glob("*.txt")))
    val_labels = len(list(config.yolo_labels_val.glob("*.txt")))

    return DatasetStatsOut(
        total_captures=len(groups),
        labeled_images=train_labels + val_labels,
        train_images=train_imgs,
        val_images=val_imgs,
    )


@api.get(
    "/dataset/export",
    operation_id="exportDataset",
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_dataset(config: ConfigDep):
    """Export the labeled dataset as a ZIP file."""
    _ensure_dirs(config)
    _ensure_data_yaml(config)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # data.yaml
        if config.data_yaml_path.exists():
            zf.write(config.data_yaml_path, "data.yaml")

        # images & labels for both splits
        for split in ("train", "val"):
            img_dir = config.yolo_images_train if split == "train" else config.yolo_images_val
            lbl_dir = config.yolo_labels_train if split == "train" else config.yolo_labels_val

            for img in img_dir.glob("*.jpg"):
                zf.write(img, f"datasets/darts/images/{split}/{img.name}")
            for lbl in lbl_dir.glob("*.txt"):
                zf.write(lbl, f"datasets/darts/labels/{split}/{lbl.name}")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=darts_dataset.zip"},
    )


# ── Detection ────────────────────────────────────────────────────────────────


@api.post(
    "/detection",
    response_model=DetectionOut,
    operation_id="runDetection",
)
async def run_detection_endpoint(
    runtime: RuntimeDep,
    cam1: Annotated[UploadFile, File()],
    cam2: Annotated[UploadFile, File()],
    cam3: Annotated[UploadFile, File()],
    calibration1: Annotated[str | None, Form()] = None,
    calibration2: Annotated[str | None, Form()] = None,
    calibration3: Annotated[str | None, Form()] = None,
) -> DetectionOut:
    """Run dart detection on 3 camera images and return the scored result."""
    from .detection import run_detection

    images: list[tuple[int, bytes]] = []
    for cam_id, upload in [(1, cam1), (2, cam2), (3, cam3)]:
        data = await upload.read()
        images.append((cam_id, data))

    calibrations: list[tuple[int, str | None]] = [
        (1, calibration1),
        (2, calibration2),
        (3, calibration3),
    ]

    if runtime.uses_remote_inference:
        return run_detection(
            images,
            calibrations,
            ws=runtime.ws,
            endpoint_name=runtime.config.serving_endpoint_name,
        )
    else:
        model = runtime.get_detection_model()
        return run_detection(images, calibrations, model=model)
