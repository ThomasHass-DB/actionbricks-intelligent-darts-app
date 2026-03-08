from enum import Enum

from pydantic import BaseModel, Field

from .. import __version__


class VersionOut(BaseModel):
    version: str

    @classmethod
    def from_metadata(cls):
        return cls(version=__version__)


# ── Camera settings ──────────────────────────────────────────────────────────


class CameraMode(str, Enum):
    local = "local"
    kinesis = "kinesis"


class KinesisChannelConfig(BaseModel):
    """Configuration for a single Kinesis Video Streams WebRTC signaling channel (one per camera)."""

    channel_name: str = Field(default="", description="Signaling channel name in AWS KVS")


class CameraSettingsIn(BaseModel):
    """Input model for updating camera settings."""

    mode: CameraMode = CameraMode.local
    service_credential_name: str = "actionbricks_video_access_1"
    region: str = Field(default="us-east-1", description="AWS region for Kinesis Video Streams")
    channels: list[KinesisChannelConfig] = Field(
        default_factory=lambda: [
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_1"),
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_2"),
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_3"),
        ],
        description="Kinesis signaling channel configuration per camera slot",
    )


class CameraSettingsOut(BaseModel):
    """Output model for camera settings."""

    mode: CameraMode
    service_credential_name: str
    region: str
    channels: list[KinesisChannelConfig]


# ── Calibration persistence ──────────────────────────────────────────────────


class CalibrationPointOut(BaseModel):
    x: float
    y: float


class CalibrationSlotIn(BaseModel):
    """Calibration data for a single camera slot."""

    device_id: str = Field(default="", description="Browser device ID (for matching)")
    device_label: str = Field(default="", description="Human-readable camera label")
    points: list[CalibrationPointOut] = Field(default_factory=list, description="4 calibration click points in image px")
    matrix: list[list[float]] = Field(default_factory=list, description="3x3 homography matrix (camera→board)")


class CalibrationSlotOut(BaseModel):
    """Stored calibration for a single camera slot."""

    device_id: str = ""
    device_label: str = ""
    points: list[CalibrationPointOut] = Field(default_factory=list)
    matrix: list[list[float]] = Field(default_factory=list)


class CalibrationDataIn(BaseModel):
    """Full calibration state to persist (all 3 camera slots)."""

    slots: list[CalibrationSlotIn] = Field(description="Calibration per camera slot (index 0-2)")


class CalibrationDataOut(BaseModel):
    """Full calibration state from disk."""

    slots: list[CalibrationSlotOut] = Field(default_factory=list)


class CalibrationSetIn(BaseModel):
    """Named calibration set to save."""

    name: str = Field(description="User-chosen name for this calibration set")
    slots: list[CalibrationSlotIn] = Field(description="Calibration per camera slot (index 0-2)")


class CalibrationSetOut(BaseModel):
    """A saved named calibration set."""

    name: str
    slots: list[CalibrationSlotOut] = Field(default_factory=list)
    created_at: str = Field(default="", description="ISO timestamp when saved")


class CalibrationSetListOut(BaseModel):
    """List of all saved calibration sets."""

    sets: list[CalibrationSetOut] = Field(default_factory=list)


# ── Data collection / labeling ───────────────────────────────────────────────


class RawCaptureGroupOut(BaseModel):
    """A single capture group (one throw = 3 camera images)."""

    capture_id: str = Field(description="Timestamp-based capture identifier")
    timestamp: str = Field(description="Human-readable timestamp")
    filenames: list[str] = Field(description="List of image filenames (cam1, cam2, cam3)")
    labeled_count: int = Field(default=0, description="How many images in this group have labels")


class RawCaptureListOut(BaseModel):
    """List of capture groups, newest first."""

    captures: list[RawCaptureGroupOut]
    total: int


class CreateCaptureOut(BaseModel):
    """Response after creating a raw capture."""

    capture_id: str
    filenames: list[str]


class KeypointIn(BaseModel):
    """A single keypoint in pixel coordinates."""

    x: float = Field(description="X coordinate in pixels")
    y: float = Field(description="Y coordinate in pixels")


class DartLabelIn(BaseModel):
    """Tip and tail keypoints for a single dart."""

    tip: KeypointIn
    tail: KeypointIn
    tail_visible: bool = Field(default=True, description="False when the tail/flight is out of frame")


class SaveLabelsIn(BaseModel):
    """Input for saving YOLO labels for a single image."""

    image_filename: str = Field(description="Filename in raw_captures, e.g. dart_20240101_120000_cam1.jpg")
    image_width: int = Field(description="Image width in pixels")
    image_height: int = Field(description="Image height in pixels")
    darts: list[DartLabelIn] = Field(description="List of dart annotations")


class SaveLabelsOut(BaseModel):
    """Response after saving labels."""

    label_path: str = Field(description="Path to the generated .txt label file")
    split: str = Field(description="Dataset split: train or val")
    num_darts: int = Field(description="Number of darts labeled")


class DeleteCaptureOut(BaseModel):
    """Response after deleting a capture group."""

    capture_id: str
    deleted_files: int


class DatasetStatsOut(BaseModel):
    """Dataset statistics for the settings UI."""

    total_captures: int = 0
    labeled_images: int = 0
    train_images: int = 0
    val_images: int = 0


# ── Detection / scoring ──────────────────────────────────────────────────────


# ── AI Commentary ──────────────────────────────────────────────────────────


class CommentaryModel(str, Enum):
    gemini_2_5_flash = "gemini-2-5-flash"
    llama_4_maverick = "llama-4-maverick"
    gpt_oss_120b = "gpt-oss-120b"
    claude_3_7_sonnet = "claude-3-7-sonnet"


class RoundScoreIn(BaseModel):
    value: int
    label: str


class CommentaryIn(BaseModel):
    score_label: str = Field(description="Score label, e.g. T20, D-BULL, MISS")
    score_value: int = Field(description="Numeric score value")
    model: CommentaryModel = Field(description="LLM model to use for commentary")
    round_scores: list[RoundScoreIn] | None = Field(
        default=None,
        description="If provided, generate a round summary instead of a single-dart commentary",
    )


class CommentaryOut(BaseModel):
    commentary: str = Field(description="Generated commentary text")
    model: str = Field(description="Model used")


# ── Detection / scoring ──────────────────────────────────────────────────────


class DetectionPointOut(BaseModel):
    """A 2D point in image pixel coordinates."""

    x: float
    y: float


class DetectionBoxOut(BaseModel):
    """Bounding box in image pixel coordinates (xyxy format)."""

    x1: float
    y1: float
    x2: float
    y2: float


class DetectedDartOut(BaseModel):
    """A single detected dart with keypoints, bbox, and scored result."""

    tip: DetectionPointOut | None = Field(default=None, description="Detected tip keypoint in image px")
    tail: DetectionPointOut | None = Field(default=None, description="Detected tail keypoint in image px")
    bbox: DetectionBoxOut | None = Field(default=None, description="Bounding box in image px")
    confidence: float | None = Field(default=None, description="Model confidence score")
    score_value: int | None = Field(default=None, description="Computed dart score (e.g. 20, 60)")
    score_label: str | None = Field(default=None, description="Human label (e.g. T20, D5, BULL)")
    segment_id: str | None = Field(default=None, description="DartBoard SVG segment id (e.g. t-20, d-5)")
    board_x: float | None = Field(default=None, description="Tip in perfect-board mm coords (x)")
    board_y: float | None = Field(default=None, description="Tip in perfect-board mm coords (y)")


class DetectionCameraOut(BaseModel):
    """Detection results for a single camera (may contain multiple darts)."""

    cam_id: int = Field(description="Camera number (1-3)")
    darts: list[DetectedDartOut] = Field(default_factory=list, description="All detected darts")
    image_width: int | None = Field(default=None, description="Source image width in px")
    image_height: int | None = Field(default=None, description="Source image height in px")


class DetectionOut(BaseModel):
    """Full detection response — results per camera + chosen best camera."""

    chosen_cam_id: int | None = Field(default=None, description="Camera that produced the best results")
    darts: list[DetectedDartOut] = Field(default_factory=list, description="All scored darts from the chosen camera")
    cameras: list[DetectionCameraOut] = Field(default_factory=list, description="Per-camera results")


# ── Game persistence ──────────────────────────────────────────────────────────


class PlayerIn(BaseModel):
    name: str


class PlayerOut(BaseModel):
    id: int
    name: str
    created_at: str


class GameIn(BaseModel):
    game_mode: str = "free"
    player_names: list[str] = Field(description="Ordered player names; creates player rows if they don't exist yet")


class GameOut(BaseModel):
    id: int
    game_mode: str
    started_at: str
    ended_at: str | None = None
    players: list[PlayerOut] = Field(default_factory=list)


class DartThrowIn(BaseModel):
    throw_number: int = Field(ge=1, le=3)
    score_value: int | None = None
    score_label: str | None = None
    segment_id: str | None = None
    board_x: float | None = None
    board_y: float | None = None
    source: str = Field(default="manual", pattern="^(manual|auto)$")
    confidence: float | None = None
    chosen_cam_id: int | None = None


class DartThrowOut(BaseModel):
    id: int
    throw_number: int
    score_value: int | None
    score_label: str | None
    segment_id: str | None
    board_x: float | None
    board_y: float | None
    source: str | None
    confidence: float | None
    chosen_cam_id: int | None
    thrown_at: str


class TurnOut(BaseModel):
    id: int
    game_id: int
    player_id: int
    player_name: str
    round_number: int
    started_at: str
    ended_at: str | None
    throws: list[DartThrowOut] = Field(default_factory=list)


class SaveTurnIn(BaseModel):
    player_id: int
    round_number: int
    throws: list[DartThrowIn] = Field(max_length=3)


class LeaderboardOut(BaseModel):
    player_name: str
    total_score: int
    rounds_played: int
    best_round: int


class SegmentHitOut(BaseModel):
    segment: str
    count: int


class ScoreBucketOut(BaseModel):
    bucket: str
    count: int


class StatsOut(BaseModel):
    total_players: int
    total_rounds: int
    avg_round_score: float
    best_round_ever: int
    top_segments: list[SegmentHitOut]
    score_distribution: list[ScoreBucketOut]


class DetectionEventIn(BaseModel):
    """Log a raw detection result for ML feedback. Set was_corrected=True + corrected_* when player overrides."""

    cam_id: int | None = None
    tip_x: float | None = None
    tip_y: float | None = None
    board_x: float | None = None
    board_y: float | None = None
    confidence: float | None = None
    score_value: int | None = None
    score_label: str | None = None
    segment_id: str | None = None
    was_corrected: bool = False
    corrected_score_value: int | None = None
    corrected_score_label: str | None = None
