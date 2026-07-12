import type { WabBridge } from '@webaibuilder/core';

declare global {
  interface Window {
    /** Von preload/index.ts per contextBridge exponiert. */
    readonly wab: WabBridge;
  }
}

export {};
