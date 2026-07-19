import { useState } from 'react';

import type { DeployProtocol } from '@webaibuilder/core';

import {
  DEPLOY_PROTOCOLS,
  defaultDeployPort,
  protocolLabel,
  validateDeployTargetInput,
  type DeployProgressState,
  type DeployTargetInput,
  type DeployTargetView,
} from '../../../shared/deploy';
import { KEYCHAIN_UNAVAILABLE_WARNING } from '../../../shared/settings';
import type { DeployHook } from '../hooks/useDeploy';
import { Icon } from './Icon';

interface DeployDialogProps {
  deploy: DeployHook;
  keychainAvailable: boolean;
  onClose: () => void;
}

interface FormState {
  id?: string;
  name: string;
  protocol: DeployProtocol;
  host: string;
  port: string;
  username: string;
  remotePath: string;
  password: string;
  passphrase: string;
}

function emptyForm(): FormState {
  return {
    name: '',
    protocol: 'sftp',
    host: '',
    port: String(defaultDeployPort('sftp')),
    username: '',
    remotePath: '/',
    password: '',
    passphrase: '',
  };
}

function formFromTarget(target: DeployTargetView): FormState {
  return {
    id: target.id,
    name: target.name,
    protocol: target.protocol,
    host: target.host,
    port: String(target.port),
    username: target.username,
    remotePath: target.remotePath,
    password: '',
    passphrase: '',
  };
}

/**
 * Deploy UI (M3, PLAN §4/§5): target list + form (password → keychain),
 * connection test, publishing with live progress and deploy history.
 * AdminCave DS: dark, hairlines, mono for host/SHA/counters, one emphasized
 * action ("Publish"). No emojis.
 */
export function DeployDialog({ deploy, keychainAvailable, onClose }: DeployDialogProps): React.JSX.Element {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = deploy.selectedTarget;
  const formError = form !== null ? validateDeployTargetInput(toInput(form)) : null;

  function openNew(): void {
    setForm(emptyForm());
    deploy.clearTestResult();
  }

  function openEdit(target: DeployTargetView): void {
    setForm(formFromTarget(target));
    deploy.clearTestResult();
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => (current === null ? current : { ...current, [key]: value }));
  }

  function changeProtocol(protocol: DeployProtocol): void {
    setForm((current) => {
      if (current === null) return current;
      // Only carry the port over if it still matches the old protocol's default.
      const wasDefault = current.port === String(defaultDeployPort(current.protocol));
      return {
        ...current,
        protocol,
        port: wasDefault ? String(defaultDeployPort(protocol)) : current.port,
      };
    });
  }

  async function submitForm(): Promise<void> {
    if (form === null || formError !== null) return;
    setSaving(true);
    const saved = await deploy.saveTarget(toInput(form));
    setSaving(false);
    if (saved !== null) setForm(null);
  }

  async function removeTarget(target: DeployTargetView): Promise<void> {
    await deploy.deleteTarget(target.id);
    if (form?.id === target.id) setForm(null);
  }

  const busy = deploy.deploying;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Publish">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <h2 className="modal__title">Publish</h2>
        </header>

        <div className="modal__body deploy">
          {!keychainAvailable && (
            <p className="form-warning" role="status">
              {KEYCHAIN_UNAVAILABLE_WARNING}
            </p>
          )}

          {/* -------- Target list -------- */}
          <section className="deploy__section">
            <div className="deploy__section-head">
              <h3 className="deploy__section-title">Deploy targets</h3>
              <button type="button" className="btn deploy__mini" onClick={openNew} disabled={busy}>
                New target
              </button>
            </div>

            {deploy.loading ? (
              <p className="deploy__hint">Loading targets …</p>
            ) : deploy.targets.length === 0 ? (
              <p className="deploy__hint">
                No target yet. Add your web space (SFTP or FTP/FTPS) to publish.
              </p>
            ) : (
              <ul className="deploy__targets">
                {deploy.targets.map((target) => (
                  <li
                    key={target.id}
                    className={
                      target.id === deploy.selectedTargetId
                        ? 'deploy__target deploy__target--active'
                        : 'deploy__target'
                    }
                  >
                    <button
                      type="button"
                      className="deploy__target-pick"
                      onClick={() => deploy.selectTarget(target.id)}
                    >
                      <span className="deploy__target-name">{target.name}</span>
                      <span className="deploy__target-meta">
                        {protocolLabel(target.protocol)} · {target.host}:{target.port} ·{' '}
                        {target.username}
                      </span>
                      <span className="deploy__target-meta">
                        {target.remotePath}
                        {target.hasCredentials ? '' : ' · no password stored'}
                        {target.lastDeployedCommit !== undefined
                          ? ` · last ${target.lastDeployedCommit.slice(0, 7)}`
                          : ' · never deployed'}
                      </span>
                    </button>
                    <div className="deploy__target-actions">
                      <button
                        type="button"
                        className="btn deploy__mini"
                        onClick={() => openEdit(target)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn deploy__mini"
                        onClick={() => void removeTarget(target)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {deploy.error !== null && (
              <p className="form-error" role="alert">
                {deploy.error}
              </p>
            )}
          </section>

          {/* -------- Form (create/edit) -------- */}
          {form !== null && (
            <form
              className="deploy__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitForm();
              }}
            >
              <h3 className="deploy__section-title">
                {form.id !== undefined ? 'Edit target' : 'New target'}
              </h3>

              <label className="field">
                <span className="field__label">Name</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.name}
                  placeholder="e.g. IONOS club site"
                  onChange={(e) => setField('name', e.target.value)}
                />
              </label>

              <div className="deploy__row">
                <label className="field">
                  <span className="field__label">Protocol</span>
                  <select
                    className="field__input"
                    value={form.protocol}
                    onChange={(e) => changeProtocol(e.target.value as DeployProtocol)}
                  >
                    {DEPLOY_PROTOCOLS.map((p) => (
                      <option key={p} value={p}>
                        {protocolLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field deploy__field-port">
                  <span className="field__label">Port</span>
                  <input
                    className="field__input"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setField('port', e.target.value)}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field__label">Host</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.host}
                  placeholder="ssh.example.org"
                  onChange={(e) => setField('host', e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Username</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.username}
                  autoComplete="off"
                  onChange={(e) => setField('username', e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Target directory</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.remotePath}
                  placeholder="/htdocs"
                  onChange={(e) => setField('remotePath', e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">
                  Password
                  {form.id !== undefined && (
                    <span className="field__hint deploy__inline-hint"> (empty = unchanged)</span>
                  )}
                </span>
                <input
                  className="field__input"
                  type="password"
                  value={form.password}
                  autoComplete="off"
                  placeholder={form.id !== undefined ? '•••••••• (leave unchanged)' : 'Password'}
                  onChange={(e) => setField('password', e.target.value)}
                />
                <span className="field__hint">
                  {keychainAvailable
                    ? 'The password is stored in the system keychain, never in plain text on disk, and is never returned to the UI.'
                    : 'Without a system keychain, the password stays in memory for this session only.'}
                </span>
              </label>

              {form.protocol === 'sftp' && (
                <label className="field">
                  <span className="field__label">
                    Passphrase
                    <span className="field__hint deploy__inline-hint"> (optional)</span>
                  </span>
                  <input
                    className="field__input"
                    type="password"
                    value={form.passphrase}
                    autoComplete="off"
                    onChange={(e) => setField('passphrase', e.target.value)}
                  />
                </label>
              )}

              {formError !== null && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}

              <div className="deploy__form-actions">
                <button type="button" className="btn" onClick={() => setForm(null)} disabled={saving}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={saving || formError !== null}
                >
                  {saving ? 'Saving …' : 'Save'}
                </button>
              </div>
            </form>
          )}

          {/* -------- Active target: test + publish -------- */}
          {selected !== null && form === null && (
            <section className="deploy__section">
              <h3 className="deploy__section-title">
                Active: <span className="deploy__mono">{selected.name}</span>
              </h3>

              {deploy.drift?.drift === true && (
                <p className="form-warning" role="status">
                  The state on the server differs from what we last deployed
                  {deploy.drift.remoteSha !== null
                    ? ` (server: ${deploy.drift.remoteSha.slice(0, 7)})`
                    : ' (the server has no state deployed by us)'}
                  . Publishing will overwrite it.
                </p>
              )}

              <div className="deploy__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void deploy.testConnection(selected.id)}
                  disabled={deploy.testing || busy}
                >
                  <Icon name="plug" size={14} />
                  {deploy.testing ? 'Testing …' : 'Test connection'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void deploy.publish()}
                  disabled={busy || !selected.hasCredentials}
                >
                  <Icon name="deploy" size={14} />
                  {busy && deploy.rollbackSha === null ? 'Publishing …' : 'Publish'}
                </button>
              </div>

              {!selected.hasCredentials && (
                <p className="deploy__hint">
                  No password is stored for this target yet — add it via "Edit".
                </p>
              )}

              {deploy.testResult !== null && <TestReport result={deploy.testResult} />}

              {(deploy.deploying || deploy.progress.phase !== 'idle') && (
                <ProgressReport progress={deploy.progress} rollbackSha={deploy.rollbackSha} />
              )}

              {/* Errors BEFORE the first progress event (e.g. "target not found")
                  produce no ProgressReport — without this line they would stay
                  invisible (outcome was set but never rendered). */}
              {deploy.outcome?.status === 'error' && deploy.progress.phase === 'idle' && (
                <p className="form-error" role="alert">
                  {deploy.outcome.message}
                </p>
              )}
            </section>
          )}

          {/* -------- History -------- */}
          <section className="deploy__section">
            <h3 className="deploy__section-title">History</h3>
            {deploy.history.length === 0 ? (
              <p className="deploy__hint">Nothing published yet.</p>
            ) : (
              <ul className="deploy__history">
                {deploy.history.map((record) => (
                  <li key={record.id} className="deploy__history-item">
                    <span className="deploy__history-line">
                      <span className="deploy__mono">{record.sha.slice(0, 7)}</span>
                      <span className="deploy__history-target">{record.targetName}</span>
                      <span className="deploy__badge-kind">
                        {record.kind === 'rollback' ? 'Rollback' : 'Deploy'}
                      </span>
                      {!record.ok && <span className="deploy__badge-fail">failed</span>}
                    </span>
                    <span className="deploy__history-meta">
                      {formatTime(record.at)}
                      {record.ok
                        ? ` · ${record.uploaded} up · ${record.deleted} deleted · ${formatBytes(record.bytesUploaded)}`
                        : record.error !== undefined
                          ? ` · ${record.error}`
                          : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="modal__actions modal__actions--footer">
          <span className="modal__actions-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Subcomponents ---------------- */

function TestReport({ result }: { result: DeployHook['testResult'] }): React.JSX.Element | null {
  if (result === null) return null;
  return (
    <div className={result.ok ? 'deploy__test deploy__test--ok' : 'deploy__test deploy__test--fail'}>
      <p className="deploy__test-title">
        <Icon name={result.ok ? 'check' : 'alert'} size={14} />
        {result.ok ? 'Connection works' : 'Connection failed'}
      </p>
      {result.failures.map((line, i) => (
        <p key={`f${i}`} className="deploy__test-fail">
          {line}
        </p>
      ))}
      {result.messages.map((line, i) => (
        <p key={`m${i}`} className="deploy__test-msg">
          {line}
        </p>
      ))}
    </div>
  );
}

function ProgressReport({
  progress,
  rollbackSha,
}: {
  progress: DeployProgressState;
  rollbackSha: string | null;
}): React.JSX.Element {
  const label = PHASE_LABEL[progress.phase];
  const uploadLine =
    progress.uploadTotal > 0 ? `${progress.uploaded}/${progress.uploadTotal}` : null;
  const deleteLine =
    progress.deleteTotal > 0 ? `${progress.deleted}/${progress.deleteTotal}` : null;
  return (
    <div className="deploy__progress">
      <p className="deploy__progress-phase">
        {rollbackSha !== null ? `Rollback to ${rollbackSha.slice(0, 7)} — ` : ''}
        {label}
      </p>
      {progress.currentFile !== null && (
        <p className="deploy__mono deploy__progress-file">{progress.currentFile}</p>
      )}
      <p className="deploy__progress-counts">
        {uploadLine !== null && <span>Uploaded: {uploadLine}</span>}
        {deleteLine !== null && <span>Deleted: {deleteLine}</span>}
        {progress.phase === 'done' && progress.result !== null && (
          <span>
            Done — {progress.result.uploaded} up · {progress.result.deleted} deleted ·{' '}
            {progress.result.unchanged} unchanged · {formatBytes(progress.result.bytesUploaded)}
          </span>
        )}
      </p>
      {progress.phase === 'error' && progress.message !== null ? (
        <p className="form-error" role="alert">
          {progress.message}
        </p>
      ) : (
        progress.message !== null && <p className="deploy__progress-msg">{progress.message}</p>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<DeployProgressState['phase'], string> = {
  idle: 'Ready',
  connecting: 'Connecting …',
  planning: 'Computing changes …',
  ensuring: 'Creating directories …',
  uploading: 'Uploading …',
  deleting: 'Cleaning up …',
  finalizing: 'Writing manifest …',
  done: 'Published',
  error: 'Error',
};

/* ---------------- Helpers ---------------- */

function toInput(form: FormState): DeployTargetInput {
  const input: DeployTargetInput = {
    name: form.name,
    protocol: form.protocol,
    host: form.host,
    port: Number.parseInt(form.port, 10),
    username: form.username,
    remotePath: form.remotePath,
  };
  if (form.id !== undefined) input.id = form.id;
  // Only send password/passphrase if typed (empty = unchanged).
  if (form.password !== '') input.password = form.password;
  if (form.passphrase !== '') input.passphrase = form.passphrase;
  return input;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
