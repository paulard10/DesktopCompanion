export const DEV_HOST = '127.0.0.1';
export const DEV_PORT = '5173';
export const APP_HOST = 'companion';

export function isDevRendererUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed?.protocol === 'http:' && parsed.hostname === DEV_HOST && parsed.port === DEV_PORT;
}

export function isPackagedRendererUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed?.protocol === 'app:' && parsed.hostname === APP_HOST;
}

export function isTrustedRendererUrl(url: string, dev: boolean): boolean {
  return dev ? isDevRendererUrl(url) : isPackagedRendererUrl(url);
}

export function isRobotRendererUrl(url: string, dev: boolean): boolean {
  const pathname = trustedPath(url, dev);
  return pathname === '/' || pathname === '/index.html';
}

export function isChatRendererUrl(url: string, dev: boolean): boolean {
  return trustedPath(url, dev) === '/chat.html';
}

export function isTrailRendererUrl(url: string, dev: boolean): boolean {
  return trustedPath(url, dev) === '/trail.html';
}

export function isHomeRendererUrl(url: string, dev: boolean): boolean {
  return url === (dev ? 'http://127.0.0.1:5173/home.html' : 'app://companion/home.html');
}

function trustedPath(url: string, dev: boolean): string | null {
  if (!isTrustedRendererUrl(url, dev)) {
    return null;
  }
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
