import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { protocol } from 'electron';
import { resolvePackagedRendererFile } from '../shared/packagedPath.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle('app', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse(405, 'Method not allowed');
    }

    const filePath = resolvePackagedRendererFile(rendererRoot, request.url);
    if (!filePath) {
      return textResponse(403, 'Forbidden');
    }

    try {
      const body = await readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const headers = {
        'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      };
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(body, { status: 200, headers });
    } catch {
      return textResponse(404, 'Not found');
    }
  });
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
