/**
 * Verwaltung der Deploy-Ziele eines Projekts (M3, PLAN §4).
 *
 * Aufteilung nach Sensibilität:
 *  - Secret-freie Felder (Protokoll, Host, Port, Benutzer, Zielverzeichnis,
 *    Anzeigename, last_deployed*) → Projekt-Registry (`deploy_targets`).
 *  - Passwort/Passphrase → OS-Schlüsselbund über secrets.ts, als EIN JSON-Secret
 *    unter `deploy:<targetId>`. `DeployTarget.credentialRef` verweist mit
 *    `keyring:deploy:<targetId>` darauf.
 *
 * Der Klartext eines Passworts verlässt nie den Main-Prozess und wird nie
 * geloggt; nach außen (Renderer) geht nur das abgeleitete `hasCredentials`-Flag.
 *
 * Registry und Schlüsselbund sind injiziert → headless mit vitest testbar
 * (temporäre DB + Secrets-Fake).
 */

import { randomUUID } from 'node:crypto';

import type { DeployTarget, Project, ProjectRegistry } from '@webaibuilder/core';

import { validateDeployTargetInput, type DeployTargetInput, type DeployTargetView } from '../shared/deploy';

/** Schmale Schlüsselbund-Schnittstelle (der echte SecretsService erfüllt sie). */
export interface DeploySecretsPort {
  setSecret(kind: 'deploy', id: string, value: string): void;
  getSecret(kind: 'deploy', id: string): string | null;
  deleteSecret(kind: 'deploy', id: string): boolean;
  hasSecret(kind: 'deploy', id: string): boolean;
}

/** Zur Laufzeit aus dem Schlüsselbund gelesene Zugangsdaten (nie persistiert). */
export interface StoredCredentials {
  password?: string;
  passphrase?: string;
}

/** `credentialRef` eines Ziels — verweist auf `deploy:<targetId>` im Schlüsselbund. */
export function credentialRefFor(targetId: string): string {
  return `keyring:deploy:${targetId}`;
}

export interface DeployTargetServiceOptions {
  /** Eindeutige Ziel-IDs (Default: randomUUID). Injizierbar für Tests. */
  idFactory?: () => string;
}

export class DeployTargetService {
  private readonly idFactory: () => string;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly secrets: DeploySecretsPort,
    options: DeployTargetServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
  }

  /** Deploy-Ziele eines Projekts als Renderer-Sicht (mit hasCredentials). */
  async list(projectId: string): Promise<DeployTargetView[]> {
    const project = await this.requireProject(projectId);
    return project.deployTargets.map((t) => this.toView(t));
  }

  /** Ein einzelnes Ziel (secret-frei) oder null. */
  async getTarget(projectId: string, targetId: string): Promise<DeployTarget | null> {
    const project = await this.requireProject(projectId);
    return project.deployTargets.find((t) => t.id === targetId) ?? null;
  }

  /**
   * Legt ein Ziel an oder ändert ein bestehendes (per `input.id`). Secret-freie
   * Felder landen in der Registry, Passwort/Passphrase im Schlüsselbund.
   */
  async save(projectId: string, input: DeployTargetInput): Promise<DeployTargetView> {
    const error = validateDeployTargetInput(input);
    if (error !== null) throw new Error(error);

    const project = await this.requireProject(projectId);
    const existing =
      input.id !== undefined ? project.deployTargets.find((t) => t.id === input.id) : undefined;
    if (input.id !== undefined && existing === undefined) {
      throw new Error('Das zu ändernde Deploy-Ziel gibt es in diesem Projekt nicht.');
    }

    const targetId = existing?.id ?? this.idFactory();
    const target: DeployTarget = {
      id: targetId,
      name: input.name.trim(),
      protocol: input.protocol,
      host: input.host.trim(),
      port: input.port,
      username: input.username.trim(),
      remotePath: input.remotePath.trim(),
      credentialRef: credentialRefFor(targetId),
      // last_deployed* beim Ändern bewahren — ein reines Bearbeiten der
      // Verbindungsdaten darf den "Deployed"-Stand nicht zurücksetzen.
      ...(existing?.lastDeployedCommit !== undefined
        ? { lastDeployedCommit: existing.lastDeployedCommit }
        : {}),
      ...(existing?.lastDeployedAt !== undefined
        ? { lastDeployedAt: existing.lastDeployedAt }
        : {}),
    };

    const nextTargets =
      existing !== undefined
        ? project.deployTargets.map((t) => (t.id === targetId ? target : t))
        : [...project.deployTargets, target];

    await this.registry.update(projectId, { deployTargets: nextTargets });

    // Secrets nur anfassen, wenn der Renderer welche mitgeschickt hat.
    if (input.password !== undefined || input.passphrase !== undefined) {
      this.writeCredentials(targetId, input, existing !== undefined);
    }

    return this.toView(target);
  }

  /** Löscht ein Ziel samt seinem Schlüsselbund-Secret. */
  async delete(projectId: string, targetId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const nextTargets = project.deployTargets.filter((t) => t.id !== targetId);
    if (nextTargets.length !== project.deployTargets.length) {
      await this.registry.update(projectId, { deployTargets: nextTargets });
    }
    // Secret immer entfernen (idempotent) — kein verwaistes Passwort im
    // Schlüsselbund zurücklassen.
    this.secrets.deleteSecret('deploy', targetId);
  }

  /**
   * Liest die Zugangsdaten eines Ziels aus dem Schlüsselbund. Nur der
   * Main-Prozess ruft das (deployService) — die Rückgabe geht nie an den
   * Renderer. Null, wenn nichts hinterlegt oder das Secret unlesbar ist.
   */
  getCredentials(targetId: string): StoredCredentials | null {
    const raw = this.secrets.getSecret('deploy', targetId);
    if (raw === null || raw === '') return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return null;
      const creds: StoredCredentials = {};
      const record = parsed as Record<string, unknown>;
      if (typeof record['password'] === 'string') creds.password = record['password'];
      if (typeof record['passphrase'] === 'string') creds.passphrase = record['passphrase'];
      return Object.keys(creds).length > 0 ? creds : null;
    } catch {
      return null;
    }
  }

  /** Liegen für dieses Ziel Zugangsdaten vor? */
  hasCredentials(targetId: string): boolean {
    return this.secrets.hasSecret('deploy', targetId);
  }

  /* ---------------- intern ---------------- */

  private writeCredentials(targetId: string, input: DeployTargetInput, isEdit: boolean): void {
    // Beim Ändern bestehende Werte als Basis nehmen, damit z. B. das Setzen der
    // Passphrase das Passwort nicht verwirft.
    const base = isEdit ? (this.getCredentials(targetId) ?? {}) : {};
    const next: StoredCredentials = { ...base };
    if (input.password !== undefined) {
      if (input.password === '') delete next.password;
      else next.password = input.password;
    }
    if (input.passphrase !== undefined) {
      if (input.passphrase === '') delete next.passphrase;
      else next.passphrase = input.passphrase;
    }
    if (next.password === undefined && next.passphrase === undefined) {
      this.secrets.deleteSecret('deploy', targetId);
    } else {
      this.secrets.setSecret('deploy', targetId, JSON.stringify(next));
    }
  }

  private toView(target: DeployTarget): DeployTargetView {
    return { ...target, hasCredentials: this.secrets.hasSecret('deploy', target.id) };
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.registry.get(projectId);
    if (project === null) throw new Error('Projekt nicht gefunden.');
    return project;
  }
}
