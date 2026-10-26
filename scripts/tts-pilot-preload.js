const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttsPilot', {
  report(line) {
    ipcRenderer.send('tts-pilot:log', String(line).slice(0, 400));
  },
});
