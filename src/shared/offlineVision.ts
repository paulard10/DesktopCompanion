/** Preview-only offline capability. No provider, pixels or generic IPC access. */
export const OFFLINE_VISION_SCENARIOS = ['success', 'empty', 'rate-limit', 'timeout'] as const;
export type OfflineVisionScenario = typeof OFFLINE_VISION_SCENARIOS[number];
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
  answer?: string;
}
