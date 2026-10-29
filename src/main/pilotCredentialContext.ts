/** Main-only, non-secret context contract. No file read, secret load or network. */
import path from 'node:path';

export const QWEN_CREDENTIAL_FILE = 'qwen-key.bin';
export const QWEN_SETTINGS_FILE = 'provider-settings.json';
export interface PilotCredentialNamespace { userData: string; sessionData: string; appName: string }
interface AppContext {
  isPackaged: boolean; isReady(): boolean; getName(): string;
  getPath(name: 'userData' | 'sessionData'): string;
  setName(name: string): void; setPath(name: 'userData' | 'sessionData', value: string): void;
}
export type CredentialContextStatus = 'CONTEXT_MATCHED' | 'APP_NOT_READY' | 'CREDENTIAL_NAMESPACE_MISMATCH'
  | 'PROVIDER_NOT_CONFIGURED' | 'CREDENTIAL_LOOKUP_ERROR' | 'CREDENTIAL_ACCESS_UNVERIFIED';
function same(a: string,b: string): boolean { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
export function credentialFiles(userData: string) {
  if (!path.isAbsolute(userData)) throw new Error('Credential namespace must be explicit and absolute.');
  const root=path.join(userData,'companion');
  return { key: path.join(root,QWEN_CREDENTIAL_FILE), settings:path.join(root,QWEN_SETTINGS_FILE) };
}
/** Caller must explicitly approve/select the development namespace. Never discover
 * or redirect to installed data. Current diagnostics pass disposable TEMP paths only. */
export function initializePilotCredentialContext(app: AppContext, approved: PilotCredentialNamespace): CredentialContextStatus {
  if (app.isPackaged || app.isReady()) return 'CREDENTIAL_ACCESS_UNVERIFIED';
  if (!path.isAbsolute(approved.userData) || !path.isAbsolute(approved.sessionData) || approved.appName!=='desktop-companion') return 'CREDENTIAL_NAMESPACE_MISMATCH';
  try {
    app.setName(approved.appName);
    app.setPath('userData',approved.userData); app.setPath('sessionData',approved.sessionData);
    return 'CONTEXT_MATCHED';
  } catch { return 'CREDENTIAL_LOOKUP_ERROR'; }
}
/** Call BEFORE existing secure-store acquisition. This status grants no inference. */
export function checkPilotCredentialContext(app: AppContext, approved: PilotCredentialNamespace, provider: string, keyId=QWEN_CREDENTIAL_FILE): CredentialContextStatus {
  if (!app.isReady()) return 'APP_NOT_READY';
  if (app.isPackaged) return 'CREDENTIAL_ACCESS_UNVERIFIED';
  if (provider!=='qwen') return 'PROVIDER_NOT_CONFIGURED';
  if (keyId!==QWEN_CREDENTIAL_FILE) return 'CREDENTIAL_LOOKUP_ERROR';
  try {
    return app.getName()===approved.appName && same(app.getPath('userData'),approved.userData) && same(app.getPath('sessionData'),approved.sessionData)
      ? 'CONTEXT_MATCHED' : 'CREDENTIAL_NAMESPACE_MISMATCH';
  } catch { return 'CREDENTIAL_LOOKUP_ERROR'; }
}
/** Fail closed before the caller constructs/loads the existing vault. No key API. */
export function requirePilotCredentialContext(app: AppContext, approved: PilotCredentialNamespace, provider: string): void {
  const status=checkPilotCredentialContext(app,approved,provider);
  if(status!=='CONTEXT_MATCHED')throw new Error(status);
}
