import { contextBridge, ipcRenderer } from 'electron';
import type { HomeBridge } from '../shared/ipc.js';

// Sandbox preloads may require Electron only; runtime channel names stay literal.
const bridge: HomeBridge = {
  notifyReady() { ipcRenderer.send('home:ready', 'home-m3.3a'); },
  notifyClick() { ipcRenderer.send('home:click'); },
  onFeedback(listener) {
    const receive = (_event: unknown, value: unknown): void => {
      if (value === 'pulse' || value === 'busy' || value === 'docked' || value === 'idle' || value === 'blocked') listener(value);
    };
    ipcRenderer.on('home:feedback', receive);
    return () => { ipcRenderer.removeListener('home:feedback', receive); };
  },
};
contextBridge.exposeInMainWorld('home', bridge);
