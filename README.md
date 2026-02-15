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
- **Streaming:** [KVS WebRTC SDK (C)](streaming/) running on Raspberry Pi 5 with 3 USB cameras
- **Deployment:** [Databricks Apps](https://docs.databricks.com/en/apps/index.html) via Databricks Asset Bundles
- **API Client:** Auto-generated TypeScript client from OpenAPI schema

## Prerequisites

- **Python 3.11+**
- **[uv](https://docs.astral.sh/uv/)** -- Python package manager
- **[Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html)** -- for deployment
- **Databricks workspace** with:
  - A service credential configured for AWS Kinesis Video Streams access (default name: `actionbricks_video_access_1`)
  - AWS Kinesis Video Streams signaling channels set up for your cameras
- **Raspberry Pi 5** (or laptop for testing) with 3 USB cameras for live video streaming (see [Camera Streaming Setup](#camera-streaming-setup))

## Getting Started

### 1. Clone and install dependencies

```bash
git clone --recursive https://github.com/ThomasHass-DB/actionbricks-intelligent-darts-app.git
cd actionbricks-intelligent-darts-app

# Install Python dependencies
uv sync

# Install JavaScript dependencies
uv run apx bun install
```

> **Note:** The `--recursive` flag clones the `streaming/` submodule (KVS WebRTC SDK) along with the main repo. If you already cloned without it, run `git submodule update --init` to fetch it.

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

## Camera Streaming Setup

The application receives live video from 3 USB cameras via AWS Kinesis Video Streams (WebRTC). The streaming component lives in the [`streaming/`](streaming/) directory (a git submodule of the [KVS WebRTC SDK for C](https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-c), customized for this project).

Each camera publishes to its own KVS signaling channel:

| Camera | Signaling Channel |
|--------|-------------------|
| USB Camera 0 | `actionbricks_demo_darts_camera_1` |
| USB Camera 1 | `actionbricks_demo_darts_camera_2` |
| USB Camera 2 | `actionbricks_demo_darts_camera_3` |

### Architecture

```
USB Camera 1 ──┐
USB Camera 2 ──┼── Raspberry Pi 5 ── KVS WebRTC ──► AWS Kinesis ──► Databricks App (viewer)
USB Camera 3 ──┘
```

### Raspberry Pi 5 Setup (Production)

1. **Install OS:** Flash [Raspberry Pi OS Bookworm 64-bit](https://www.raspberrypi.com/software/) to an SD card and boot the Pi.

2. **Copy the repo** to the Pi (from your laptop):

   ```bash
   rsync -avz --progress \
     --exclude 'build/' --exclude 'open-source/' --exclude '.git/' \
     streaming/ <PI_USER>@<PI_IP>:~/amazon-kinesis-video-streams-webrtc-sdk-c/
   ```

3. **Build on the Pi** (one-time setup):

   ```bash
   ssh <PI_USER>@<PI_IP>
   cd ~/amazon-kinesis-video-streams-webrtc-sdk-c
   ./setup_pi.sh
   ```

   This installs all dependencies (GStreamer, build tools, OpenSSL) and compiles the SDK. Takes a few minutes on a Pi 5.

4. **Export AWS credentials** and start streaming:

   ```bash
   export AWS_ACCESS_KEY_ID="..."
   export AWS_SECRET_ACCESS_KEY="..."
   export AWS_SESSION_TOKEN="..."    # if using temporary credentials
   export AWS_DEFAULT_REGION="us-east-1"

   ./run_3_streams_pi.sh
   ```

   Press `Ctrl+C` to stop all streams.

### Laptop Setup (Testing)

For local testing on macOS:

```bash
cd streaming
mkdir -p build && cd build
cmake ..
make -j4

# Export AWS credentials, then run a single camera stream:
./samples/kvsWebrtcClientMasterGstSample <channel_name> video-only devicesrc <device_index>
```

### Video Pipeline Configuration

The GStreamer pipeline is configurable via environment variables. Defaults work well on a laptop; the Pi script sets lower values for 3 simultaneous streams:

| Variable | Default | Pi Default | Description |
|----------|---------|------------|-------------|
| `KVS_VIDEO_WIDTH` | `1280` | `640` | Output width (px) |
| `KVS_VIDEO_HEIGHT` | `720` | `480` | Output height (px) |
| `KVS_VIDEO_FPS` | `25` | `20` | Target framerate |
| `KVS_VIDEO_BITRATE` | `512` | `384` | H.264 bitrate (kbps) |
| `KVS_ENCODER_PRESET` | `veryfast` | `ultrafast` | x264enc speed preset |

Override any setting by exporting the variable before running the stream script.

### USB Camera Notes

- Each USB camera creates two `/dev/video*` nodes on Linux (capture + metadata). The streaming app filters these automatically and only shows real capture devices.
- The Raspberry Pi 5's ISP backend (`pispbe`) also registers as Video/Source devices. These are automatically filtered out.
- For a stable camera-to-channel mapping, always plug each camera into the same USB port.
- The Pi 5 has two USB 3.0 controllers. Spread cameras across both buses if you experience bandwidth issues.

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
├── streaming/            # Git submodule: KVS WebRTC SDK (C)
│   ├── samples/          # Modified GStreamer streaming sample
│   ├── setup_pi.sh       # One-time Raspberry Pi build script
│   ├── run_3_streams_pi.sh  # Launch 3 camera streams (Pi)
│   └── ...
├── app.yml               # Databricks Apps runtime config
├── databricks.yml        # Databricks Asset Bundle config
├── pyproject.toml        # Python project config
├── package.json          # Frontend dependencies
└── README.md
```

---

Built with [apx](https://github.com/databricks-solutions/apx)
