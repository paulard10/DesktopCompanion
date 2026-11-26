/** Frameless chat window. It can take focus when opened, and it is not kept above other apps. */

export interface ChatWebPreferences {
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

export interface ChatChrome {
  frame: false;
  transparent: false;
  alwaysOnTop: false;
  skipTaskbar: false;
  resizable: true;
  maximizable: false;
  minimizable: true;
  fullscreenable: false;
  hasShadow: true;
  focusable: true;
  show: false;
  thickFrame: false;
  backgroundColor: '#f3f0ea';
  backgroundMaterial: 'none';
  roundedCorners: true;
  autoHideMenuBar: true;
  title: string;
}

export function createChatWebPreferences(preloadPath: string, dev: boolean): ChatWebPreferences {
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

export function createChatChrome(): ChatChrome {
  return {
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    hasShadow: true,
    focusable: true,
    show: false,
    thickFrame: false,
    backgroundColor: '#f3f0ea',
    backgroundMaterial: 'none',
    roundedCorners: true,
    autoHideMenuBar: true,
    title: 'Worthsi',
  };
}
