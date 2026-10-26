import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.html', '.js', '.css', '.map', '.svg', '.png', '.woff2']);

export function resolvePackagedRendererFile(root: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'app:' || url.hostname !== 'companion') {
      return null;
    }
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (pathname.includes('\0')) {
    return null;
  }

  const relative = pathname.replace(/^\/+/, '');
  const fileRelative = relative === '' ? 'index.html' : relative;
  if (fileRelative.endsWith('/')) {
    return null;
  }

  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, fileRelative);
  const fromRoot = path.relative(rootResolved, candidate);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    return null;
  }

  const extension = path.extname(candidate).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return null;
  }

  return candidate;
}
