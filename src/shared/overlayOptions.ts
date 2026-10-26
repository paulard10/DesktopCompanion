export const OVERLAY_ALWAYS_ON_TOP_LEVEL = 'floating' as const;

export interface OverlayWebPreferences {
  preload: string;
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  allowRunningInsecureContent: false;
  spellcheck: false;
  devTools: boolean;
  nodeIntegrationInWorker: false;
  nodeIntegrationInSubFrames: false;
}

export interface OverlayChrome {
  frame: false;
  transparent: true;
  alwaysOnTop: true;
  skipTaskbar: true;
  resizable: false;
  maximizable: false;
  minimizable: false;
  fullscreenable: false;
  hasShadow: false;
  focusable: false;
  show: false;
  thickFrame: false;
  backgroundColor: '#00000000';
  backgroundMaterial: 'none';
  roundedCorners: false;
  autoHideMenuBar: true;
  paintWhenInitiallyHidden: true;
}

export function createOverlayWebPreferences(preloadPath: string, dev: boolean): OverlayWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    devTools: dev,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
  };
}

export function createOverlayChrome(): OverlayChrome {
  return {
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none',
    roundedCorners: false,
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: true,
  };
}
