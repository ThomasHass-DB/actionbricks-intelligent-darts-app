from __future__ import annotations

from databricks.sdk import WorkspaceClient

from .config import AppConfig
from .logger import logger
from .models import CameraMode, CameraSettingsOut, KinesisChannelConfig


def _default_camera_settings() -> CameraSettingsOut:
    return CameraSettingsOut(
        mode=CameraMode.kinesis,
        service_credential_name="actionbricks_video_access_1",
        region="us-east-1",
        channels=[
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_1"),
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_2"),
            KinesisChannelConfig(channel_name="actionbricks_demo_darts_camera_3"),
        ],
    )


class Runtime:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.camera_settings: CameraSettingsOut = _default_camera_settings()
        self._detection_model = None

    def get_detection_model(self):
        """Lazily load and cache the YOLO detection model."""
        if self._detection_model is None:
            from .detection import load_model

            model_path = self.config.detection_model_path
            if not model_path.exists():
                from fastapi import HTTPException

                raise HTTPException(
                    status_code=500,
                    detail=f"Detection model not found at {model_path}",
                )
            logger.info(f"Loading detection model from {model_path}")
            self._detection_model = load_model(model_path)
        return self._detection_model

    @property
    def ws(self) -> WorkspaceClient:
        # note - this workspace client is usually an SP-based client
        # in development it usually uses the DATABRICKS_CONFIG_PROFILE
        return WorkspaceClient()
