// Isolated Chromium speechSynthesis pilot. Not imported by the DesktopCompanion app.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(here, 'tts-pilot.html');
const preload = path.join(here, 'tts-pilot-preload.js');
const headless = process.argv.includes('--headless');
const autoPlay = process.argv.includes('--autoplay');
const cancelTest = process.argv.includes('--cancel-test');

if (process.platform !== 'win32') {
  console.error('tts-pilot: Windows only');
  process.exit(1);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 820,
    height: 640,
    show: !headless,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let finished = false;
  const quitTimer = setTimeout(() => {
    if (!finished) {
      console.error('tts-pilot: timed out waiting for playback');
      app.exit(2);
    }
  }, 30_000);
  ipcMain.on('tts-pilot:log', (_event, line) => {
    console.log('tts-pilot: ' + line);
    const done =
      (autoPlay && typeof line === 'string' && line.includes(' onend ')) ||
      (cancelTest && typeof line === 'string' && line.includes('cancel-test auto-cancel'));
    if (done) {
      finished = true;
      clearTimeout(quitTimer);
      setTimeout(() => app.exit(0), 200);
    }
  });
  void win.loadFile(html);

  win.webContents.on('did-finish-load', () => {
    if (cancelTest) {
      void win.webContents.executeJavaScript(`document.getElementById('cancel-test').click();`);
      return;
    }
    if (!autoPlay) {
      return;
    }
    void win.webContents.executeJavaScript(`
      (function () {
        const voices = speechSynthesis.getVoices();
        const pick =
          voices.find((v) => v.lang.toLowerCase().startsWith('es') && v.localService) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es')) ||
          voices[0];
        if (pick) {
          document.getElementById('voice').value = pick.voiceURI;
        }
        document.getElementById('play').click();
      })();
    `);
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('tts-pilot:')) {
      console.log(message);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
