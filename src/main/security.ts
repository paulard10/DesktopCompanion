import { app, session, systemPreferences, type Session, type WebContents } from 'electron';
import { contentSecurityPolicy } from '../shared/csp.js';
import { isChatRendererUrl, isTrustedRendererUrl } from '../shared/trustedUrl.js';

export interface MicrophoneGate {
  arm: (contents: WebContents) => boolean;
  disarm: (contents: WebContents) => void;
}

export function installSecurityPolicy(dev: boolean): MicrophoneGate {
  const armed = new WeakMap<WebContents, number>();
  const allowed = (contents: WebContents | null, url: string | undefined): boolean => {
    if (!contents || contents.isDestroyed() || !isChatRendererUrl(contents.getURL(), dev) ||
        !url || !isChatRendererUrl(url, dev)) return false;
    return (armed.get(contents) ?? 0) > Date.now();
  };
  hardenSession(session.defaultSession, dev, allowed);

  app.on('web-contents-created', (_event, contents) => {
    hardenContents(contents, dev);
  });

  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(false);
  });
  return {
    arm(contents) {
      if (contents.isDestroyed() || !isChatRendererUrl(contents.getURL(), dev)) return false;
      const osStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (osStatus === 'denied' || osStatus === 'restricted') return false;
      armed.set(contents, Date.now() + 10_000);
      return true;
    },
    disarm(contents) { armed.delete(contents); },
  };
}

function hardenSession(
  ses: Session,
  dev: boolean,
  allowed: (contents: WebContents | null, url: string | undefined) => boolean,
): void {
  const policy = contentSecurityPolicy(dev);

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const request = details as { mediaTypes?: string[]; requestingUrl?: string };
    const media = permission === 'media' && request.mediaTypes?.length === 1 &&
      request.mediaTypes[0] === 'audio';
    callback(Boolean(media && allowed(contents, request.requestingUrl)));
  });
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return permission === 'media' && details.mediaType === 'audio' &&
      details.isMainFrame !== false && allowed(contents, details.requestingUrl);
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!isTrustedRendererUrl(details.url, dev)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': [policy],
    };
    callback({ responseHeaders });
  });
}

function hardenContents(contents: WebContents, dev: boolean): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, dev)) {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, dev)) {
      event.preventDefault();
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}
