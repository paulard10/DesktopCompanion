/** Singapore Model Studio workspace endpoint. Imports nothing. */

const WORKSPACE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ap-southeast-1\.maas\.aliyuncs\.com$/;

export const QWEN_MODEL_ID = 'qwen3.7-plus';

export function parseSingaporeEndpoint(
  raw: string,
): { ok: true; baseUrl: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return { ok: false };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false };
  }
  const host = url.hostname.toLowerCase();
  if (!WORKSPACE_HOST.test(host)) {
    return { ok: false };
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '/compatible-mode/v1' && path !== '/compatible-mode/v1/chat/completions') {
    return { ok: false };
  }
  return { ok: true, baseUrl: `https://${host}/compatible-mode/v1` };
}

export function sanitizeStoredSettings(parsed: unknown): {
  provider: 'demo' | 'qwen';
  endpoint: string | null;
  strippedSecret: boolean;
} {
  if (!parsed || typeof parsed !== 'object') {
    return { provider: 'demo', endpoint: null, strippedSecret: false };
  }
  const record = parsed as Record<string, unknown>;
  const strippedSecret = 'apiKey' in record || 'key' in record || 'token' in record || 'authorization' in record;
  const provider = record.provider === 'qwen' ? 'qwen' : 'demo';
  const endpoint = typeof record.endpoint === 'string' ? parseSingaporeEndpoint(record.endpoint) : { ok: false as const };
  return {
    provider,
    endpoint: endpoint.ok ? endpoint.baseUrl : null,
    strippedSecret,
  };
}

export function chatCompletionsUrl(baseUrl: string): string | null {
  const parsed = parseSingaporeEndpoint(baseUrl);
  if (!parsed.ok) {
    return null;
  }
  return `${parsed.baseUrl}/chat/completions`;
}
