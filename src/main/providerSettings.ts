import fs from 'node:fs';
import path from 'node:path';
import { sanitizeStoredSettings } from '../shared/qwenEndpoint.js';

export interface ProviderSettings {
  provider: 'demo' | 'qwen';
  endpoint: string | null;
}

export function createProviderSettings(filePath: string): {
  current(): ProviderSettings;
  update(next: ProviderSettings): void;
} {
  let state = readSettings(filePath);
  return {
    current: () => state,
    update(next: ProviderSettings): void {
      state = { provider: next.provider, endpoint: next.endpoint };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
    },
  };
}

function readSettings(filePath: string): ProviderSettings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const clean = sanitizeStoredSettings(parsed);
    if (clean.strippedSecret) {
      fs.writeFileSync(filePath, JSON.stringify({ provider: clean.provider, endpoint: clean.endpoint }), 'utf8');
    }
    return { provider: clean.provider, endpoint: clean.endpoint };
  } catch {
    return { provider: 'demo', endpoint: null };
  }
}
