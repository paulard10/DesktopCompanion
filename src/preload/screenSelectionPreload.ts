import { contextBridge, ipcRenderer } from 'electron';
import type { ScreenSelectionBridge, SelectionNotice } from '../shared/screenSelection.js';

const bridge: ScreenSelectionBridge = {
  ready() {
    const view = globalThis as unknown as { innerWidth: number; innerHeight: number; devicePixelRatio: number };
    ipcRenderer.send('selection:ready', { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio });
  },
  select(id, display, rect) { ipcRenderer.send('selection:select', id, display, rect); },
  confirm(id, display) { ipcRenderer.send('selection:confirm', id, display); },
  cancel(id) { ipcRenderer.send('selection:cancel', id); },
  onNotice(listener) {
    const receive = (_event: unknown, notice: SelectionNotice): void => { listener(notice); };
    ipcRenderer.on('selection:notice', receive);
    return () => { ipcRenderer.removeListener('selection:notice', receive); };
  },
};
contextBridge.exposeInMainWorld('screenSelection', bridge);
