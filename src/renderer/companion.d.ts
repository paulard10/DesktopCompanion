import type { CompanionBridge } from '../shared/ipc';

declare global {
  interface Window {
    companion: CompanionBridge;
  }
}

export {};
