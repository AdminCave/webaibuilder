/**
 * Preload bridge contract (`window.wab`) — versioned and minimal.
 * Preload implements this interface, the renderer consumes it.
 */

import type { PingResult } from './ipc';
import type { Project, ProjectCreateInput, ProjectUpdateInput, StarterTemplate } from './project';

/** Key under which the bridge is exposed in the renderer: `window.wab`. */
export const BRIDGE_KEY = 'wab';

/** Increment on incompatible changes to `WabBridge`.
 *  v2: `projects.create` takes `ProjectCreateInput` (name + template) instead
 *  of just a name; new: `projects.update/delete`, `templates.list`. */
export const BRIDGE_VERSION = 2;

export interface WabBridge {
  readonly version: typeof BRIDGE_VERSION;
  ping(): Promise<PingResult>;
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | null>;
    create(input: ProjectCreateInput): Promise<Project>;
    update(id: string, patch: ProjectUpdateInput): Promise<Project>;
    delete(id: string): Promise<void>;
  };
  templates: {
    list(): Promise<StarterTemplate[]>;
  };
}
