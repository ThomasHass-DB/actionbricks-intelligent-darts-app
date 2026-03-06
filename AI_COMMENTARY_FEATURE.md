# AI Commentary Feature

## Overview

The AI commentary feature uses a Databricks Model Serving / AI Gateway endpoint to generate one-line, enthusiastic darts commentary for each throw and for the round total after three darts. The frontend supports optional text-to-speech (TTS) with selectable voice tones.

## Requirements

_TODO: Define requirements below_
- For development use the default profile as defined in databricks config.
- Use Databricks Model Serving Endpoint

### Core Functionality
The AI commentary feature uses a Databricks Model Serving / AI Gateway endpoint to generate one-line, enthusiastic darts commentary for each throw and for the round total after three darts. The frontend supports optional text-to-speech (TTS) with selectable voice tones.


### User Experience
- When AI Commentary is enabled, the hardcoded/static commentary must be hidden. Only the AI-generated commentary should be displayed.
- When AI Commentary is disabled, the default hardcoded commentary is shown as before.

### Technical Requirements
- Use Databricks model serving endpoints with AI Gateway configuration
- Each LLM model has its own **AI Gateway endpoint** that proxies to a Databricks Foundation Model API model. All endpoints have inference tables and usage tracking enabled, logging to the same Unity Catalog schema.
- **Inference tables** automatically capture every request/response payload to a Unity Catalog Delta table. No application-level logging code is needed.
- **Usage tracking** is enabled on all endpoints for token/cost monitoring.
- Inference table and usage tracking destination: `classic_stable_5aj75r_catalog.intelligent_darts_app` schema.
- Secret scope `intelligent_darts` with key `databricks_api_token` stores the workspace token for endpoint authentication.

### What Inference Tables Capture Automatically
Once enabled on the serving endpoint, inference tables log every call with no extra code:
- `request` — full JSON payload sent to the LLM (prompt, model, parameters)
- `response` — full JSON response from the LLM (generated text, token usage)
- `timestamp_ms`, `status_code`, `execution_time_ms`
- `databricks_request_id` for tracing

## Design

### Backend Changes
- Add a new API route `POST /api/commentary` that accepts:
  - `score_label` (e.g., "T20", "D-BULL", "MISS")
  - `score_value` (numeric score)
  - `model` (one of: `gemini-2-5-flash`, `llama-4-maverick`, `gpt-oss-120b`, `claude-3-7-sonnet`)
  - Optional: `round_scores` (list of scores for round summary after 3 darts)
- The backend maps the selected model to the corresponding AI Gateway endpoint name:

  | Frontend Model Name | Backend Endpoint Name |
  |---|---|
  | `gemini-2-5-flash` | `intelligent_darts_databricks-gemini-2-5-flash` |
  | `llama-4-maverick` | `intelligent_darts_databricks-llama-4-maverick` |
  | `gpt-oss-120b` | `intelligent_darts_databricks-gpt-oss-120b` |
  | `claude-3-7-sonnet` | `intelligent_darts_databricks-claude-3-7-sonnet` |

- Call the endpoint using `w.serving_endpoints.query()` with OpenAI-compatible chat completions format (system prompt + user message with score details)
- Return the generated commentary text to the frontend

### Frontend Changes
- Add a "Use AI commentary" toggle just under the score section
- When enabled, show a dropdown to select one of the LLM models: gemini-2-5-flash, llama-4-maverick, gpt-oss-120b, claude-3-7-sonnet
- After each dart detection, call `POST /api/commentary` with the score and selected model, and display the returned commentary text
- After 3 darts in a round, call `POST /api/commentary` with all round scores for a round summary
- Add a TTS toggle with selectable voice tones (Enthusiastic, Warm and Friendly) using the browser Web Speech API (`speechSynthesis.speak()`) with pitch/rate presets
- Commentary and TTS state should persist across throws within a session but not across page reloads

### AI/LLM Integration
- The LLM model when selected generates the commentary for every dart score as detected by the application. The commentary should be very enthusiastic with a one-line catchy sentence along with the score.
- For the score "D-BULL" the commentary should mention BULL's EYE
- After three darts, generate a round summary commentary with the total score

## AI Gateway Endpoint Setup

The script `scripts/create_ai_gateway.sh` provisions 4 AI Gateway endpoints on the `fe-vm-classic-stable-5aj75r` workspace — one per Foundation Model API model. Each endpoint uses `external_model` with `databricks-model-serving` provider, and has inference tables + usage tracking enabled.

### Configuration
- **Databricks CLI profile:** `fe-vm-classic-stable-5aj75r`
- **Workspace:** `https://fevm-classic-stable-5aj75r.cloud.databricks.com`
- **Secret scope:** `intelligent_darts` / key: `databricks_api_token`

### Endpoints (one per model)

| Endpoint Name | Foundation Model |
|---|---|
| `intelligent_darts_databricks-gemini-2-5-flash` | `databricks-gemini-2-5-flash` |
| `intelligent_darts_databricks-llama-4-maverick` | `databricks-llama-4-maverick` |
| `intelligent_darts_databricks-gpt-oss-120b` | `databricks-gpt-oss-120b` |
| `intelligent_darts_databricks-claude-3-7-sonnet` | `databricks-claude-3-7-sonnet` |

### Inference Table & Usage Tracking
- **Catalog:** `classic_stable_5aj75r_catalog`
- **Schema:** `intelligent_darts_app`
- Each endpoint logs to this schema with its own table name prefix (matching the endpoint name)
- Both inference tables (request/response payloads) and usage tracking (token counts, cost) are enabled

### Script Usage
```bash
# Create all 4 AI Gateway endpoints with inference tables and usage tracking
./scripts/create_ai_gateway.sh
```

## Model Performance Dashboard

A Databricks AI/BI (Lakeview) dashboard analyzes inference table data across all 4 models to rank their performance on two dimensions: response time and commentary quality.

- **Dashboard:** [AI Commentary Model Performance](https://fevm-classic-stable-5aj75r.cloud.databricks.com/sql/dashboardsv3/01f118a75a6b19f996f97ed4f5210e61)
- **Dashboard ID:** `01f118a75a6b19f996f97ed4f5210e61`

### Page 1: Performance Overview

| Widget | Type | Description |
|--------|------|-------------|
| Total Inference Requests | Counter | Total successful requests across all models |
| Request Distribution by Model | Pie | Volume breakdown per model |
| Response Time Ranking (Avg ms) | Bar | Average response time per model, sorted fastest first |
| P50 & P95 Response Times | Grouped Bar | Latency percentiles per model (P50 vs P95 as color groups) |
| Response Time Stats | Table | Full stats: avg, p50, p95, min, max per model |
| Avg Token Usage by Model | Grouped Bar | Prompt vs completion tokens per model |

### Page 2: Quality Assessment

| Widget | Type | Description |
|--------|------|-------------|
| Commentary Quality Ranking | Bar | Average AI-judged quality score (1-10), sorted highest first |
| Quality Score Summary | Table | Avg/min/max quality scores per model |
| Individual Commentary Quality Assessments | Table | Each commentary with its dart score, AI quality assessment, and response time |

### AI-Powered Quality Scoring

Quality is assessed using `ai_query('databricks-claude-3-7-sonnet', ...)` — the Databricks SQL AI function. For each commentary in the inference tables, Claude 3.7 Sonnet is used as an LLM judge to rate the response on a 1-10 scale for enthusiasm, wit, and relevance to the dart score.

### Data Sources

The dashboard queries all 4 inference payload tables using a `UNION ALL`:
- `classic_stable_5aj75r_catalog.intelligent_darts_app.intelligent_darts_databricks-gemini-2-5-flash_payload`
- `classic_stable_5aj75r_catalog.intelligent_darts_app.intelligent_darts_databricks-llama-4-maverick_payload`
- `classic_stable_5aj75r_catalog.intelligent_darts_app.intelligent_darts_databricks-gpt-oss-120b_payload`
- `classic_stable_5aj75r_catalog.intelligent_darts_app.intelligent_darts_databricks-claude-3-7-sonnet_payload`

Key columns used: `model` (derived from table), `execution_duration_ms`, `request` (JSON — prompt extraction), `response` (JSON — commentary text and token usage).

## Databricks Asset Bundles (DABs) Deployment

To make the AI Commentary feature portable across different Databricks workspaces, all infrastructure resources are defined as Databricks Asset Bundles (DABs) resources in `databricks.yml`. This replaces the manual `scripts/create_ai_gateway.sh` script and manual dashboard creation with a declarative, version-controlled configuration.

### What DABs Manages

| Resource Type | Resource | Description |
|---------------|----------|-------------|
| `model_serving_endpoints` | 4 AI Gateway endpoints | One per LLM model, each with `external_model` (provider: `databricks-model-serving`), inference tables, and usage tracking |
| `dashboards` | Performance dashboard | Lakeview dashboard for model response time ranking and AI-judged quality assessment |
| `schemas` | Inference table schema | Unity Catalog schema for inference table storage |

### Bundle Variables

The following variables make the bundle portable across workspaces:

| Variable | Description | Default |
|----------|-------------|---------|
| `catalog` | Unity Catalog catalog for inference tables | (workspace default catalog) |
| `schema` | Schema name for inference tables | `intelligent_darts_app` |
| `workspace_url` | Databricks workspace URL (for external_model routing) | `${workspace.host}` |
| `databricks_api_token_secret` | Secret reference for API token | `{{secrets/intelligent_darts/databricks_api_token}}` |
| `warehouse_id` | SQL warehouse ID for the dashboard | (must be set per target) |

### Target Configuration

Each target (workspace) overrides the variables:

```yaml
targets:
  dev:
    mode: development
    default: true
    variables:
      catalog: "dev_catalog"
      warehouse_id: "abc123"

  staging:
    variables:
      catalog: "staging_catalog"
      warehouse_id: "def456"
```

### Deployment

```bash
# Validate the bundle
databricks bundle validate --profile <profile>

# Deploy all resources (endpoints + dashboard + schema)
databricks bundle deploy --profile <profile>

# Deploy to a specific target
databricks bundle deploy --target staging --profile <profile>

# Destroy resources
databricks bundle destroy --profile <profile>
```

### File Structure

```
databricks.yml                          # Main bundle config with resources
resources/
  ai_commentary_endpoints.yml           # 4 model serving endpoint definitions
  ai_commentary_dashboard.yml           # Dashboard resource definition
  ai_commentary_dashboard.lvdash.json   # Lakeview dashboard serialized JSON
```

## Open Questions
- ~~Which Unity Catalog catalog/schema should the inference table be created in?~~ **Answered:** `classic_stable_5aj75r_catalog.intelligent_darts_app`
- ~~Should rate limits be configured per-model on the AI Gateway endpoint?~~ **Answered:** No
- ~~What TTS engine to use for the text-to-speech feature?~~ **Answered:** Use the browser-native **Web Speech API** (`speechSynthesis.speak()`). Tone presets map to pitch/rate parameters: Enthusiastic (pitch 1.2, rate 1.3), Warm and Friendly (pitch 1.0, rate 0.9). Zero dependencies, no backend changes needed.
