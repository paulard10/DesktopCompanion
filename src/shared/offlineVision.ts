/** Preview-only offline capability. No provider, pixels or generic IPC access. */
export const OFFLINE_VISION_SCENARIOS = ['success', 'empty', 'rate-limit', 'timeout'] as const;
export type OfflineVisionScenario = typeof OFFLINE_VISION_SCENARIOS[number];
/** Disclosure only: neither a live switch nor a request/authorization capability. */
export const VISION_SHARING = Object.freeze({
  provider: 'Alibaba Cloud Model Studio', region: 'Singapore', model: 'qwen3.7-plus',
  remoteStatus: 'unavailable', remoteConsent: 'not-requested',
  identity: 'Future provider: Alibaba Cloud Model Studio · Singapore · qwen3.7-plus',
  boundary: 'Local capture is not permission to upload. Remote sending is unavailable in this version; Run offline vision test stays entirely local.',
  shared: 'A future separately authorized request would share exactly this cropped PNG, your exact edited question, minimal instructions and API request metadata.',
  excluded: 'It would not include the full desktop, other windows outside the crop, clipboard, chat history, microphone/audio, local paths, screen coordinates or unrelated settings. Check that the crop itself contains only what you intend to share.',
  risks: 'The provider may retain submitted data under its applicable policies, and inference may incur charges. After transmission, cancellation or a timeout cannot recall the image or guarantee that it was not processed or billed.',
} as const);
export interface OfflineVisionReview {
  purpose: 'offline-simulation-only'; sessionId: string; imageId: string; revision: number;
  question: string; provider: typeof VISION_SHARING.provider; region: typeof VISION_SHARING.region;
  model: typeof VISION_SHARING.model; mime: 'image/png'; width: number; height: number; pngBytes: number;
  expiresAt: number; previewExpiresAt: number;
}
export interface VisionImageEligibility { available: boolean; message: string }
export const VISION_IMAGE_UNAVAILABLE = 'Vision unavailable for this crop: use an RGB/RGBA PNG, at most 2 MiB, 2048 pixels per side and 2,097,152 pixels, smaller than the display. Preview and Discard remain available. Discard and select a smaller area from the tray. No resizing or transmission occurred.';
export function validVisionQuestion(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 500 &&
    new TextEncoder().encode(value).byteLength <= 2000 &&
    new TextDecoder().decode(new TextEncoder().encode(value)) === value &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
export type OfflineVisionAction =
  | { type: 'edit' | 'review'; sessionId: string; question: string; revision: number; scenario: OfflineVisionScenario }
  | { type: 'run'; sessionId: string; token: string; revision: number }
  | { type: 'cancel'; sessionId: string };
export interface OfflineVisionNotice {
  phase: 'editing' | 'review' | 'running' | 'result' | 'error';
  question: string; revision: number; scenario: OfflineVisionScenario;
  imageId: string; message: string; token?: string; expiresAt?: number;
  sharing: typeof VISION_SHARING; imageEligibility: VisionImageEligibility;
  previewExpiresAt: number; review?: Readonly<OfflineVisionReview>;
  answer?: string;
}
