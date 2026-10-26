import type { ChatBridge } from '../shared/ipc';

declare global {
  interface Window {
    chat: ChatBridge;
  }
}

export {};
