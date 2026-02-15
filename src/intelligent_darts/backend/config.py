from importlib import resources
from pathlib import Path
from typing import ClassVar

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .._metadata import app_name, app_slug

# project root is the parent of the src folder
project_root = Path(__file__).parent.parent.parent.parent
env_file = project_root / ".env"

if env_file.exists():
    load_dotenv(dotenv_path=env_file)


class AppConfig(BaseSettings):
    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_file=env_file, env_prefix=f"{app_slug.upper()}_", extra="ignore"
    )
    app_name: str = Field(default=app_name)

    @property
    def static_assets_path(self) -> Path:
        return Path(str(resources.files(app_slug))).joinpath("__dist__")

    # ── Dataset paths ────────────────────────────────────────────────────────

    @property
    def dataset_root(self) -> Path:
        return project_root / "dataset"

    @property
    def raw_captures_dir(self) -> Path:
        return self.dataset_root / "raw_captures"

    @property
    def yolo_root(self) -> Path:
        return project_root / "datasets" / "darts"

    @property
    def yolo_images_train(self) -> Path:
        return self.yolo_root / "images" / "train"

    @property
    def yolo_images_val(self) -> Path:
        return self.yolo_root / "images" / "val"

    @property
    def yolo_labels_train(self) -> Path:
        return self.yolo_root / "labels" / "train"

    @property
    def yolo_labels_val(self) -> Path:
        return self.yolo_root / "labels" / "val"

    @property
    def data_yaml_path(self) -> Path:
        return self.dataset_root / "data.yaml"

    # ── Calibration persistence ──────────────────────────────────────────────

    @property
    def calibration_file_path(self) -> Path:
        return project_root / "calibration.json"

    # ── Detection model ──────────────────────────────────────────────────────

    serving_endpoint_name: str | None = Field(
        default=None,
        description="Databricks Model Serving endpoint name. "
        "When set, remote inference is used instead of the local YOLO model.",
    )

    @property
    def detection_model_path(self) -> Path:
        return project_root / "best.pt"
