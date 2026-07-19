/**
 * Management of a project's deploy targets (M3, PLAN §4).
 *
 * Split by sensitivity:
 *  - Secret-free fields (protocol, host, port, user, target directory, display
 *    name, last_deployed*) → project registry (`deploy_targets`).
 *  - Password/passphrase → OS keychain via secrets.ts, as ONE JSON secret under
 *    `deploy:<targetId>`. `DeployTarget.credentialRef` points to it with
 *    `keyring:deploy:<targetId>`.
 *
 * The plaintext of a password never leaves the main process and is never logged;
 * only the derived `hasCredentials` flag goes outward (to the renderer).
 *
 * Registry and keychain are injected → headless testable with vitest
 * (temporary DB + secrets fake).
 */

import { randomUUID } from 'node:crypto';

import type { DeployTarget, Project, ProjectRegistry } from '@webaibuilder/core';

import { validateDeployTargetInput, type DeployTargetInput, type DeployTargetView } from '../shared/deploy';

/** Narrow keychain interface (the real SecretsService satisfies it). */
export interface DeploySecretsPort {
  setSecret(kind: 'deploy', id: string, value: string): void;
  getSecret(kind: 'deploy', id: string): string | null;
  deleteSecret(kind: 'deploy', id: string): boolean;
  hasSecret(kind: 'deploy', id: string): boolean;
}

/** Credentials read from the keychain at runtime (never persisted). */
export interface StoredCredentials {
  password?: string;
  passphrase?: string;
}

/** A target's `credentialRef` — points to `deploy:<targetId>` in the keychain. */
export function credentialRefFor(targetId: string): string {
  return `keyring:deploy:${targetId}`;
}

export interface DeployTargetServiceOptions {
  /** Unique target IDs (default: randomUUID). Injectable for tests. */
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

  /** A project's deploy targets as the renderer view (with hasCredentials). */
  async list(projectId: string): Promise<DeployTargetView[]> {
    const project = await this.requireProject(projectId);
    return project.deployTargets.map((t) => this.toView(t));
  }

  /** A single target (secret-free) or null. */
  async getTarget(projectId: string, targetId: string): Promise<DeployTarget | null> {
    const project = await this.requireProject(projectId);
    return project.deployTargets.find((t) => t.id === targetId) ?? null;
  }

  /**
   * Creates a target or updates an existing one (by `input.id`). Secret-free
   * fields land in the registry, password/passphrase in the keychain.
   */
  async save(projectId: string, input: DeployTargetInput): Promise<DeployTargetView> {
    const error = validateDeployTargetInput(input);
    if (error !== null) throw new Error(error);

    const project = await this.requireProject(projectId);
    const existing =
      input.id !== undefined ? project.deployTargets.find((t) => t.id === input.id) : undefined;
    if (input.id !== undefined && existing === undefined) {
      throw new Error('The deploy target to update does not exist in this project.');
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
      // Preserve last_deployed* on update — editing only the connection details
      // must not reset the "deployed" state.
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

    // Only touch secrets if the renderer sent any along.
    if (input.password !== undefined || input.passphrase !== undefined) {
      this.writeCredentials(targetId, input, existing !== undefined);
    }

    return this.toView(target);
  }

  /** Deletes a target along with its keychain secret. */
  async delete(projectId: string, targetId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const nextTargets = project.deployTargets.filter((t) => t.id !== targetId);
    if (nextTargets.length !== project.deployTargets.length) {
      await this.registry.update(projectId, { deployTargets: nextTargets });
    }
    // Always remove the secret (idempotent) — do not leave an orphaned password
    // in the keychain.
    this.secrets.deleteSecret('deploy', targetId);
  }

  /**
   * Reads a target's credentials from the keychain. Only the main process calls
   * this (deployService) — the return value never goes to the renderer. Null if
   * nothing is stored or the secret is unreadable.
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

  /** Are credentials present for this target? */
  hasCredentials(targetId: string): boolean {
    return this.secrets.hasSecret('deploy', targetId);
  }

  /* ---------------- internal ---------------- */

  private writeCredentials(targetId: string, input: DeployTargetInput, isEdit: boolean): void {
    // On update, take existing values as the base so that, e.g., setting the
    // passphrase does not discard the password.
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
    if (project === null) throw new Error('Project not found.');
    return project;
  }
}
