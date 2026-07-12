import type { WabBridge } from '@webaibuilder/core';

import type { WabDesktopBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Von preload/index.ts per contextBridge exponiert (core-Vertrag + M2-Erweiterung). */
    readonly wab: WabBridge & WabDesktopBridge;
  }
}

export {};
