import { useQuery, useSuspenseQuery, useMutation } from "@tanstack/react-query";
import type { UseQueryOptions, UseSuspenseQueryOptions, UseMutationOptions } from "@tanstack/react-query";

export interface Body_createRawCapture {
  cam1: string;
  cam2: string;
  cam3: string;
  timestamp: string;
}

export interface Body_runDetection {
  calibration1?: string | null;
  calibration2?: string | null;
  calibration3?: string | null;
  cam1: string;
  cam2: string;
  cam3: string;
}

export interface CalibrationDataIn {
  slots: CalibrationSlotIn[];
}

export interface CalibrationDataOut {
  slots?: CalibrationSlotOut[];
}

export interface CalibrationPointOut {
  x: number;
  y: number;
}

export interface CalibrationSetIn {
  name: string;
  slots: CalibrationSlotIn[];
}

export interface CalibrationSetListOut {
  sets?: CalibrationSetOut[];
}

export interface CalibrationSetOut {
  created_at?: string;
  name: string;
  slots?: CalibrationSlotOut[];
}

export interface CalibrationSlotIn {
  device_id?: string;
  device_label?: string;
  matrix?: number[][];
  points?: CalibrationPointOut[];
}

export interface CalibrationSlotOut {
  device_id?: string;
  device_label?: string;
  matrix?: number[][];
  points?: CalibrationPointOut[];
}

export const CameraMode = {
  local: "local",
  kinesis: "kinesis",
} as const;

export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode];

export interface CameraSettingsIn {
  channels?: KinesisChannelConfig[];
  mode?: CameraMode;
  region?: string;
  service_credential_name?: string;
}

export interface CameraSettingsOut {
  channels: KinesisChannelConfig[];
  mode: CameraMode;
  region: string;
  service_credential_name: string;
}

export interface CommentaryIn {
  model: CommentaryModel;
  round_scores?: RoundScoreIn[] | null;
  score_label: string;
  score_value: number;
}

export const CommentaryModel = {
  "gemini-2-5-flash": "gemini-2-5-flash",
  "llama-4-maverick": "llama-4-maverick",
  "gpt-oss-120b": "gpt-oss-120b",
  "claude-3-7-sonnet": "claude-3-7-sonnet",
} as const;

export type CommentaryModel = (typeof CommentaryModel)[keyof typeof CommentaryModel];

export interface CommentaryOut {
  commentary: string;
  model: string;
}

export interface ComplexValue {
  display?: string | null;
  primary?: boolean | null;
  ref?: string | null;
  type?: string | null;
  value?: string | null;
}

export interface CreateCaptureOut {
  capture_id: string;
  filenames: string[];
}

export interface DartLabelIn {
  tail: KeypointIn;
  tail_visible?: boolean;
  tip: KeypointIn;
}

export interface DatasetStatsOut {
  labeled_images?: number;
  total_captures?: number;
  train_images?: number;
  val_images?: number;
}

export interface DeleteCaptureOut {
  capture_id: string;
  deleted_files: number;
}

export interface DetectedDartOut {
  bbox?: DetectionBoxOut | null;
  board_x?: number | null;
  board_y?: number | null;
  confidence?: number | null;
  score_label?: string | null;
  score_value?: number | null;
  segment_id?: string | null;
  tail?: DetectionPointOut | null;
  tip?: DetectionPointOut | null;
}

export interface DetectionBoxOut {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface DetectionCameraOut {
  cam_id: number;
  darts?: DetectedDartOut[];
  image_height?: number | null;
  image_width?: number | null;
}

export interface DetectionOut {
  cameras?: DetectionCameraOut[];
  chosen_cam_id?: number | null;
  darts?: DetectedDartOut[];
}

export interface DetectionPointOut {
  x: number;
  y: number;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

export interface IceServer {
  credential?: string;
  urls: string[];
  username?: string;
}

export interface KeypointIn {
  x: number;
  y: number;
}

export interface KinesisChannelConfig {
  channel_name?: string;
}

export interface Name {
  family_name?: string | null;
  given_name?: string | null;
}

export interface RawCaptureGroupOut {
  capture_id: string;
  filenames: string[];
  labeled_count?: number;
  timestamp: string;
}

export interface RawCaptureListOut {
  captures: RawCaptureGroupOut[];
  total: number;
}

export interface RoundScoreIn {
  label: string;
  value: number;
}

export interface SaveLabelsIn {
  darts: DartLabelIn[];
  image_filename: string;
  image_height: number;
  image_width: number;
}

export interface SaveLabelsOut {
  label_path: string;
  num_darts: number;
  split: string;
}

export interface User {
  active?: boolean | null;
  display_name?: string | null;
  emails?: ComplexValue[] | null;
  entitlements?: ComplexValue[] | null;
  external_id?: string | null;
  groups?: ComplexValue[] | null;
  id?: string | null;
  name?: Name | null;
  roles?: ComplexValue[] | null;
  schemas?: UserSchema[] | null;
  user_name?: string | null;
}

export const UserSchema = {
  "urn:ietf:params:scim:schemas:core:2.0:User": "urn:ietf:params:scim:schemas:core:2.0:User",
  "urn:ietf:params:scim:schemas:extension:workspace:2.0:User": "urn:ietf:params:scim:schemas:extension:workspace:2.0:User",
} as const;

export type UserSchema = (typeof UserSchema)[keyof typeof UserSchema];

export interface ValidationError {
  ctx?: Record<string, unknown>;
  input?: unknown;
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface VersionOut {
  version: string;
}

export interface ViewerConnectionInfo {
  channel_arn: string;
  ice_servers?: IceServer[];
  region?: string;
  signed_wss_url?: string;
  wss_endpoint: string;
}

export interface DeleteCalibrationSetParams {
  set_name: string;
}

export interface CurrentUserParams {
  "X-Forwarded-Access-Token"?: string | null;
}

export interface GetKinesisViewerConfigParams {
  channel_name: string;
}

export interface DeleteRawCaptureParams {
  capture_id: string;
}

export interface GetRawCaptureImageParams {
  capture_id: string;
  cam_id: number;
}

export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export const getCalibration = async (options?: RequestInit): Promise<{ data: CalibrationDataOut }> => {
  const res = await fetch("/api/calibration", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const getCalibrationKey = () => {
  return ["/api/calibration"] as const;
};

export function useGetCalibration<TData = { data: CalibrationDataOut }>(options?: { query?: Omit<UseQueryOptions<{ data: CalibrationDataOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: getCalibrationKey(), queryFn: () => getCalibration(), ...options?.query });
}

export function useGetCalibrationSuspense<TData = { data: CalibrationDataOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: CalibrationDataOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: getCalibrationKey(), queryFn: () => getCalibration(), ...options?.query });
}

export const saveCalibration = async (data: CalibrationDataIn, options?: RequestInit): Promise<{ data: CalibrationDataOut }> => {
  const res = await fetch("/api/calibration", { ...options, method: "PUT", headers: { "Content-Type": "application/json", ...options?.headers }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useSaveCalibration(options?: { mutation?: UseMutationOptions<{ data: CalibrationDataOut }, ApiError, CalibrationDataIn> }) {
  return useMutation({ mutationFn: (data) => saveCalibration(data), ...options?.mutation });
}

export const listCalibrationSets = async (options?: RequestInit): Promise<{ data: CalibrationSetListOut }> => {
  const res = await fetch("/api/calibration/sets", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const listCalibrationSetsKey = () => {
  return ["/api/calibration/sets"] as const;
};

export function useListCalibrationSets<TData = { data: CalibrationSetListOut }>(options?: { query?: Omit<UseQueryOptions<{ data: CalibrationSetListOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: listCalibrationSetsKey(), queryFn: () => listCalibrationSets(), ...options?.query });
}

export function useListCalibrationSetsSuspense<TData = { data: CalibrationSetListOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: CalibrationSetListOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: listCalibrationSetsKey(), queryFn: () => listCalibrationSets(), ...options?.query });
}

export const saveCalibrationSet = async (data: CalibrationSetIn, options?: RequestInit): Promise<{ data: CalibrationSetOut }> => {
  const res = await fetch("/api/calibration/sets", { ...options, method: "POST", headers: { "Content-Type": "application/json", ...options?.headers }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useSaveCalibrationSet(options?: { mutation?: UseMutationOptions<{ data: CalibrationSetOut }, ApiError, CalibrationSetIn> }) {
  return useMutation({ mutationFn: (data) => saveCalibrationSet(data), ...options?.mutation });
}

export const deleteCalibrationSet = async (params: DeleteCalibrationSetParams, options?: RequestInit): Promise<{ data: CalibrationSetListOut }> => {
  const res = await fetch(`/api/calibration/sets/${params.set_name}`, { ...options, method: "DELETE" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useDeleteCalibrationSet(options?: { mutation?: UseMutationOptions<{ data: CalibrationSetListOut }, ApiError, { params: DeleteCalibrationSetParams }> }) {
  return useMutation({ mutationFn: (vars) => deleteCalibrationSet(vars.params), ...options?.mutation });
}

export const getCameraSettings = async (options?: RequestInit): Promise<{ data: CameraSettingsOut }> => {
  const res = await fetch("/api/camera-settings", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const getCameraSettingsKey = () => {
  return ["/api/camera-settings"] as const;
};

export function useGetCameraSettings<TData = { data: CameraSettingsOut }>(options?: { query?: Omit<UseQueryOptions<{ data: CameraSettingsOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: getCameraSettingsKey(), queryFn: () => getCameraSettings(), ...options?.query });
}

export function useGetCameraSettingsSuspense<TData = { data: CameraSettingsOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: CameraSettingsOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: getCameraSettingsKey(), queryFn: () => getCameraSettings(), ...options?.query });
}

export const updateCameraSettings = async (data: CameraSettingsIn, options?: RequestInit): Promise<{ data: CameraSettingsOut }> => {
  const res = await fetch("/api/camera-settings", { ...options, method: "PUT", headers: { "Content-Type": "application/json", ...options?.headers }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useUpdateCameraSettings(options?: { mutation?: UseMutationOptions<{ data: CameraSettingsOut }, ApiError, CameraSettingsIn> }) {
  return useMutation({ mutationFn: (data) => updateCameraSettings(data), ...options?.mutation });
}

export const generateCommentary = async (data: CommentaryIn, options?: RequestInit): Promise<{ data: CommentaryOut }> => {
  const res = await fetch("/api/commentary", { ...options, method: "POST", headers: { "Content-Type": "application/json", ...options?.headers }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useGenerateCommentary(options?: { mutation?: UseMutationOptions<{ data: CommentaryOut }, ApiError, CommentaryIn> }) {
  return useMutation({ mutationFn: (data) => generateCommentary(data), ...options?.mutation });
}

export const currentUser = async (params?: CurrentUserParams, options?: RequestInit): Promise<{ data: User }> => {
  const res = await fetch("/api/current-user", { ...options, method: "GET", headers: { ...(params?.["X-Forwarded-Access-Token"] != null && { "X-Forwarded-Access-Token": params["X-Forwarded-Access-Token"] }), ...options?.headers } });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const currentUserKey = (params?: CurrentUserParams) => {
  return ["/api/current-user", params] as const;
};

export function useCurrentUser<TData = { data: User }>(options?: { params?: CurrentUserParams; query?: Omit<UseQueryOptions<{ data: User }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: currentUserKey(options?.params), queryFn: () => currentUser(options?.params), ...options?.query });
}

export function useCurrentUserSuspense<TData = { data: User }>(options?: { params?: CurrentUserParams; query?: Omit<UseSuspenseQueryOptions<{ data: User }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: currentUserKey(options?.params), queryFn: () => currentUser(options?.params), ...options?.query });
}

export const exportDataset = async (options?: RequestInit): Promise<{ data: unknown }> => {
  const res = await fetch("/api/dataset/export", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const exportDatasetKey = () => {
  return ["/api/dataset/export"] as const;
};

export function useExportDataset<TData = { data: unknown }>(options?: { query?: Omit<UseQueryOptions<{ data: unknown }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: exportDatasetKey(), queryFn: () => exportDataset(), ...options?.query });
}

export function useExportDatasetSuspense<TData = { data: unknown }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: unknown }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: exportDatasetKey(), queryFn: () => exportDataset(), ...options?.query });
}

export const getDatasetStats = async (options?: RequestInit): Promise<{ data: DatasetStatsOut }> => {
  const res = await fetch("/api/dataset/stats", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const getDatasetStatsKey = () => {
  return ["/api/dataset/stats"] as const;
};

export function useGetDatasetStats<TData = { data: DatasetStatsOut }>(options?: { query?: Omit<UseQueryOptions<{ data: DatasetStatsOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: getDatasetStatsKey(), queryFn: () => getDatasetStats(), ...options?.query });
}

export function useGetDatasetStatsSuspense<TData = { data: DatasetStatsOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: DatasetStatsOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: getDatasetStatsKey(), queryFn: () => getDatasetStats(), ...options?.query });
}

export const runDetection = async (data: FormData, options?: RequestInit): Promise<{ data: DetectionOut }> => {
  const res = await fetch("/api/detection", { ...options, method: "POST", headers: { ...options?.headers }, body: data });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useRunDetection(options?: { mutation?: UseMutationOptions<{ data: DetectionOut }, ApiError, FormData> }) {
  return useMutation({ mutationFn: (data) => runDetection(data), ...options?.mutation });
}

export const getKinesisViewerConfig = async (params: GetKinesisViewerConfigParams, options?: RequestInit): Promise<{ data: ViewerConnectionInfo }> => {
  const searchParams = new URLSearchParams();
  if (params.channel_name != null) searchParams.set("channel_name", String(params.channel_name));
  const queryString = searchParams.toString();
  const url = queryString ? `/api/kinesis/viewer-config?${queryString}` : `/api/kinesis/viewer-config`;
  const res = await fetch(url, { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const getKinesisViewerConfigKey = (params?: GetKinesisViewerConfigParams) => {
  return ["/api/kinesis/viewer-config", params] as const;
};

export function useGetKinesisViewerConfig<TData = { data: ViewerConnectionInfo }>(options: { params: GetKinesisViewerConfigParams; query?: Omit<UseQueryOptions<{ data: ViewerConnectionInfo }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: getKinesisViewerConfigKey(options.params), queryFn: () => getKinesisViewerConfig(options.params), ...options?.query });
}

export function useGetKinesisViewerConfigSuspense<TData = { data: ViewerConnectionInfo }>(options: { params: GetKinesisViewerConfigParams; query?: Omit<UseSuspenseQueryOptions<{ data: ViewerConnectionInfo }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: getKinesisViewerConfigKey(options.params), queryFn: () => getKinesisViewerConfig(options.params), ...options?.query });
}

export const saveYoloLabels = async (data: SaveLabelsIn, options?: RequestInit): Promise<{ data: SaveLabelsOut }> => {
  const res = await fetch("/api/labels", { ...options, method: "PUT", headers: { "Content-Type": "application/json", ...options?.headers }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useSaveYoloLabels(options?: { mutation?: UseMutationOptions<{ data: SaveLabelsOut }, ApiError, SaveLabelsIn> }) {
  return useMutation({ mutationFn: (data) => saveYoloLabels(data), ...options?.mutation });
}

export const listRawCaptures = async (options?: RequestInit): Promise<{ data: RawCaptureListOut }> => {
  const res = await fetch("/api/raw-captures", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const listRawCapturesKey = () => {
  return ["/api/raw-captures"] as const;
};

export function useListRawCaptures<TData = { data: RawCaptureListOut }>(options?: { query?: Omit<UseQueryOptions<{ data: RawCaptureListOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: listRawCapturesKey(), queryFn: () => listRawCaptures(), ...options?.query });
}

export function useListRawCapturesSuspense<TData = { data: RawCaptureListOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: RawCaptureListOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: listRawCapturesKey(), queryFn: () => listRawCaptures(), ...options?.query });
}

export const createRawCapture = async (data: FormData, options?: RequestInit): Promise<{ data: CreateCaptureOut }> => {
  const res = await fetch("/api/raw-captures", { ...options, method: "POST", headers: { ...options?.headers }, body: data });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useCreateRawCapture(options?: { mutation?: UseMutationOptions<{ data: CreateCaptureOut }, ApiError, FormData> }) {
  return useMutation({ mutationFn: (data) => createRawCapture(data), ...options?.mutation });
}

export const deleteRawCapture = async (params: DeleteRawCaptureParams, options?: RequestInit): Promise<{ data: DeleteCaptureOut }> => {
  const res = await fetch(`/api/raw-captures/${params.capture_id}`, { ...options, method: "DELETE" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export function useDeleteRawCapture(options?: { mutation?: UseMutationOptions<{ data: DeleteCaptureOut }, ApiError, { params: DeleteRawCaptureParams }> }) {
  return useMutation({ mutationFn: (vars) => deleteRawCapture(vars.params), ...options?.mutation });
}

export const getRawCaptureImage = async (params: GetRawCaptureImageParams, options?: RequestInit): Promise<{ data: unknown }> => {
  const res = await fetch(`/api/raw-captures/${params.capture_id}/cam/${params.cam_id}`, { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const getRawCaptureImageKey = (params?: GetRawCaptureImageParams) => {
  return ["/api/raw-captures/{capture_id}/cam/{cam_id}", params] as const;
};

export function useGetRawCaptureImage<TData = { data: unknown }>(options: { params: GetRawCaptureImageParams; query?: Omit<UseQueryOptions<{ data: unknown }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: getRawCaptureImageKey(options.params), queryFn: () => getRawCaptureImage(options.params), ...options?.query });
}

export function useGetRawCaptureImageSuspense<TData = { data: unknown }>(options: { params: GetRawCaptureImageParams; query?: Omit<UseSuspenseQueryOptions<{ data: unknown }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: getRawCaptureImageKey(options.params), queryFn: () => getRawCaptureImage(options.params), ...options?.query });
}

export const version = async (options?: RequestInit): Promise<{ data: VersionOut }> => {
  const res = await fetch("/api/version", { ...options, method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  return { data: await res.json() };
};

export const versionKey = () => {
  return ["/api/version"] as const;
};

export function useVersion<TData = { data: VersionOut }>(options?: { query?: Omit<UseQueryOptions<{ data: VersionOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useQuery({ queryKey: versionKey(), queryFn: () => version(), ...options?.query });
}

export function useVersionSuspense<TData = { data: VersionOut }>(options?: { query?: Omit<UseSuspenseQueryOptions<{ data: VersionOut }, ApiError, TData>, "queryKey" | "queryFn"> }) {
  return useSuspenseQuery({ queryKey: versionKey(), queryFn: () => version(), ...options?.query });
}

