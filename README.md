# Intelligent Darts

A full-stack intelligent dart scoring application that uses computer vision and machine learning to automatically detect and score darts on a dartboard. Built with [apx](https://github.com/databricks-solutions/apx) for deployment on [Databricks Apps](https://docs.databricks.com/en/apps/index.html).

## How It Works

- **Live camera feeds** are streamed via AWS Kinesis Video Streams (WebRTC) from cameras pointed at a dartboard.
- A **YOLO object detection model** (`best.pt`) identifies dart tip positions in each camera frame.
- **Homography transforms** map detected pixel coordinates onto a canonical dartboard layout to determine which segment was hit.
- The **frontend** renders a live dartboard overlay, scoring UI, and supports interactive game modes (e.g. 501, Cricket).
- A **labeling tool** is included for capturing images and creating YOLO-format training datasets to improve the model.

## Tech Stack

- **Backend:** Python 3.11+ / [FastAPI](https://fastapi.tiangolo.com/)
- **Frontend:** React 19 / TypeScript / [shadcn/ui](https://ui.shadcn.com/) / [TanStack Router](https://tanstack.com/router)
- **ML:** [Ultralytics YOLO](https://docs.ultralytics.com/) for dart detection
- **Video:** AWS Kinesis Video Streams WebRTC for live camera feeds
- **Deployment:** [Databricks Apps](https://docs.databricks.com/en/apps/index.html) via Databricks Asset Bundles
- **API Client:** Auto-generated TypeScript client from OpenAPI schema

## Prerequisites

- **Python 3.11+**
- **[uv](https://docs.astral.sh/uv/)** -- Python package manager
- **[Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html)** -- for deployment
- **Databricks workspace** with:
  - A service credential configured for AWS Kinesis Video Streams access (default name: `actionbricks_video_access_1`)
  - AWS Kinesis Video Streams signaling channels set up for your cameras

## Getting Started

### 1. Clone and install dependencies

```bash
git clone https://github.com/ThomasHass-DB/actionbricks-intelligent-darts-app.git
cd actionbricks-intelligent-darts-app

# Install Python dependencies
uv sync

# Install JavaScript dependencies
uv run apx bun install
```

### 2. Configure environment

Create a `.env` file in the project root:

```bash
# Databricks CLI profile to use
DATABRICKS_CONFIG_PROFILE=<your-profile>
```

### 3. Provide a detection model (optional)

The app expects a YOLO model file at `best.pt` in the project root. You can either:

- **Train your own** using the built-in labeling tool (see below), or
- **Skip it** -- the app will still run but dart detection will be unavailable.

### 4. Start development servers

```bash
uv run apx dev start
```

This starts the backend (FastAPI), frontend (Vite), and OpenAPI client watcher in the background.

### Useful commands

```bash
# View logs
uv run apx dev logs

# Stream logs in real-time
uv run apx dev logs -f

# Check server status
uv run apx dev status

# Run type checking (TypeScript + Python)
uv run apx dev check

# Stop all servers
uv run apx dev stop
```

## Training a Custom Model

1. Start the app and navigate to the **Settings** page to configure your camera channels and calibration.
2. Use the **Labeling** page to capture images from the live camera feeds and annotate dart positions.
3. The labeling tool exports data in YOLO format to the `datasets/darts/` directory.
4. Train a YOLO model using [Ultralytics](https://docs.ultralytics.com/modes/train/):

```bash
uv run yolo detect train data=dataset/data.yaml model=yolov8n.pt epochs=100 imgsz=640
```

5. Copy the best weights to the project root:

```bash
cp runs/detect/train/weights/best.pt .
```

## Deployment

Build and deploy to Databricks Apps:

```bash
# Build the production bundle
uv run apx build

# Deploy using Databricks Asset Bundles
databricks bundle deploy -p <your-profile>
```

## Project Structure

```
.
├── src/intelligent_darts/
│   ├── backend/          # FastAPI backend
│   │   ├── app.py        # Application entrypoint
│   │   ├── config.py     # Configuration (pydantic-settings)
│   │   ├── router.py     # API routes
│   │   ├── detection.py  # YOLO dart detection
│   │   ├── kinesis_webrtc.py  # AWS Kinesis WebRTC integration
│   │   └── ...
│   └── ui/               # React frontend
│       ├── routes/        # TanStack Router pages
│       ├── components/    # UI components (shadcn/ui)
│       ├── lib/           # Utility libraries
│       └── ...
├── app.yml               # Databricks Apps runtime config
├── databricks.yml        # Databricks Asset Bundle config
├── pyproject.toml        # Python project config
├── package.json          # Frontend dependencies
└── README.md
```

---

Built with [apx](https://github.com/databricks-solutions/apx)
