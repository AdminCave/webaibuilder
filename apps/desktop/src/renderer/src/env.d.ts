import type { WabBridge } from '@webaibuilder/core';

import type { WabDesktopBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Exposed by preload/index.ts via contextBridge (core contract + M2 extension). */
    readonly wab: WabBridge & WabDesktopBridge;
  }
}

export {};
