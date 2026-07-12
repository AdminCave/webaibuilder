/**
 * Workspace- und Projekt-Typen (PLAN §4, Workspace-Layout):
 * `~/WebAIBuilder/<projekt>/` mit `site/` (Docroot), `.git/`, `project.json`.
 */

import type { BackendId } from './agent';

export const WORKSPACE_ROOT_DIRNAME = 'WebAIBuilder';
export const SITE_DIRNAME = 'site';
export const PROJECT_FILE_NAME = 'project.json';

export type DeployProtocol = 'sftp' | 'ftp' | 'ftps';

/** Ein Deploy-Ziel (klassischer Webspace). Secrets liegen NIE hier — nur eine
 *  Referenz auf den OS-Schlüsselbund (PLAN §4, Deploy-Engine). */
export interface DeployTarget {
  id: string;
  /** Anzeigename, z. B. "IONOS Vereinsseite". */
  name: string;
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  /** Zielverzeichnis auf dem Server, z. B. "/htdocs". */
  remotePath: string;
  /** Referenz auf das Secret im OS-Schlüsselbund (@napi-rs/keyring). */
  credentialRef: string;
  /** Commit-SHA aus dem Remote-Manifest (`.wab-manifest.json`) — "welche
   *  Version ist auf diesem Ziel deployt" (PLAN §4). */
  lastDeployedCommit?: string;
  lastDeployedAt?: string;
}

/** Ein Checkpoint = ein Commit im Workspace-git (UI sagt nie "git"). */
export interface Checkpoint {
  /** Commit-SHA. */
  id: string;
  /** Erste Prompt-Zeile des Turns bzw. manuelle Beschreibung. */
  message: string;
  createdAt: string;
  /** Trailer-Metadaten des Agent-Turns (PLAN §4, Versionierung). */
  turnId?: string;
  backend?: BackendId;
  sessionId?: string;
  costUsd?: number;
  /** Anzeigename, falls als benannte Version getaggt (annotated Tag). */
  versionName?: string;
  /** true, wenn diese SHA im Remote-Manifest eines Deploy-Ziels steht. */
  deployed?: boolean;
}

/** Eine Starter-Vorlage für neue Projekte (statisches HTML/CSS/JS, PLAN §2). */
export interface StarterTemplate {
  /** Ordnername unter resources/templates, z. B. "einseiter". */
  id: string;
  /** Anzeigename, z. B. "Einseiter". */
  name: string;
  /** Kurzbeschreibung fürs Neues-Projekt-Formular. */
  description: string;
}

/** Ein Projekt in der Registry (Inhalt von `project.json` + Laufzeitfelder). */
export interface Project {
  id: string;
  name: string;
  /** Absoluter Pfad: `~/WebAIBuilder/<projekt>`. */
  workspaceDir: string;
  /** Absoluter Pfad des Docroot: `<workspaceDir>/site`. */
  siteDir: string;
  /** Vorlage, aus der das Projekt erzeugt wurde. */
  templateId: string;
  createdAt: string;
  updatedAt: string;
  /** Zuletzt benutztes KI-Backend. */
  lastBackend?: BackendId;
  deployTargets: DeployTarget[];
}

export interface ProjectCreateInput {
  name: string;
  /** Starter-Vorlage (`StarterTemplate.id`), aus der `site/` befüllt wird. */
  templateId: string;
}

/** Partielles Update — nur gesetzte Felder werden geändert. `deployTargets`
 *  ersetzt die komplette Liste (inkl. `lastDeployedCommit` pro Ziel). */
export interface ProjectUpdateInput {
  name?: string;
  lastBackend?: BackendId;
  deployTargets?: DeployTarget[];
}

/**
 * Projekt-Registry-Vertrag. Implementiert im Electron-Main-Prozess mit
 * better-sqlite3 (`apps/desktop/src/main/registry.ts`); DB-Pfad, Workspace-
 * Wurzel und Vorlagen-Ordner sind injizierbar (headless testbar).
 */
export interface ProjectRegistry {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  /** Legt Workspace + `site/` + `project.json` an und kopiert die Vorlage. */
  create(input: ProjectCreateInput): Promise<Project>;
  update(id: string, patch: ProjectUpdateInput): Promise<Project>;
  /** Entfernt das Projekt aus der Registry; der Workspace auf der Platte
   *  bleibt bewusst erhalten (Nutzerdaten werden nie still gelöscht). */
  delete(id: string): Promise<void>;
  /** Verfügbare Starter-Vorlagen fürs Neues-Projekt-Formular. */
  listTemplates(): Promise<StarterTemplate[]>;
}
