/**
 * Vertrag der Preload-Bridge (`window.wab`) — versioniert und minimal.
 * Preload implementiert dieses Interface, der Renderer konsumiert es.
 */

import type { PingResult } from './ipc';
import type { Project, ProjectCreateInput, ProjectUpdateInput, StarterTemplate } from './project';

/** Schlüssel, unter dem die Bridge im Renderer hängt: `window.wab`. */
export const BRIDGE_KEY = 'wab';

/** Bei inkompatiblen Änderungen an `WabBridge` hochzählen.
 *  v2: `projects.create` nimmt `ProjectCreateInput` (Name + Vorlage) statt
 *  nur einen Namen; neu: `projects.update/delete`, `templates.list`. */
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
