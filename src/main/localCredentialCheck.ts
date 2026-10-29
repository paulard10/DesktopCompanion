/** Local-only diagnostic. Not imported by normal app, preload or transport. */
import fs from 'node:fs';
import { parseSingaporeEndpoint } from '../shared/qwenEndpoint.js';
import type { LocalCredentialOutcome } from '../shared/keyVault.js';
import { checkPilotCredentialContext, credentialFiles, type PilotCredentialNamespace } from './pilotCredentialContext.js';

export type LocalCheckOutcome = LocalCredentialOutcome | 'CREDENTIAL_NAMESPACE_MISMATCH'
  | 'APP_CONTEXT_INVALID' | 'PROVIDER_CONFIGURATION_INCOMPLETE';
type DiagnosticApp = Parameters<typeof checkPilotCredentialContext>[0];

/** Does not call the normal settings reader, which can rewrite legacy records. */
export function providerConfiguredReadOnly(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 16_384) return false;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    // Never sanitize/rewrite or accept a second plaintext key location.
    if (['apiKey', 'key', 'token', 'authorization'].some(key => key in record)) return false;
    return record.provider === 'qwen' && typeof record.endpoint === 'string' && parseSingaporeEndpoint(record.endpoint).ok;
  } catch { return false; }
}

export function createLocalCredentialCheck(options: {
  app: DiagnosticApp; expected: PilotCredentialNamespace;
  readOnlyAvailability: (file: string) => Promise<LocalCredentialOutcome>;
}) {
  let entered = false;
  return async (): Promise<{ outcome: LocalCheckOutcome; retrievalAttempted: boolean }> => {
    if (entered) return { outcome: 'UNVERIFIED_SAFE_STOP', retrievalAttempted: false };
    entered = true; // No retry even after a failed precondition.
    const context = checkPilotCredentialContext(options.app, options.expected, 'qwen');
    if (context !== 'CONTEXT_MATCHED') return {
      outcome: context === 'CREDENTIAL_NAMESPACE_MISMATCH' ? context : 'APP_CONTEXT_INVALID', retrievalAttempted: false,
    };
    const files = credentialFiles(options.expected.userData);
    if (!providerConfiguredReadOnly(files.settings)) return { outcome: 'PROVIDER_CONFIGURATION_INCOMPLETE', retrievalAttempted: false };
    try { return { outcome: await options.readOnlyAvailability(files.key), retrievalAttempted: true }; }
    catch { return { outcome: 'UNVERIFIED_SAFE_STOP', retrievalAttempted: true }; }
  };
}
