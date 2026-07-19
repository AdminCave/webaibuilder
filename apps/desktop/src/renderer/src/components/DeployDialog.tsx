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
 * Deploy-Oberfläche (M3, PLAN §4/§5): Ziel-Liste + Formular (Passwort →
 * Schlüsselbund), Verbindungstest, Veröffentlichen mit Live-Fortschritt und
 * Deploy-Historie. AdminCave-DS: dunkel, Hairlines, Mono für Host/SHA/Zähler,
 * eine betonte Aktion („Veröffentlichen"). Deutsch, Du-Form, keine Emojis.
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
      // Port nur mitziehen, wenn er noch dem Default des alten Protokolls entspricht.
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
    <div className="modal" role="dialog" aria-modal="true" aria-label="Veröffentlichen">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <h2 className="modal__title">Veröffentlichen</h2>
        </header>

        <div className="modal__body deploy">
          {!keychainAvailable && (
            <p className="form-warning" role="status">
              {KEYCHAIN_UNAVAILABLE_WARNING}
            </p>
          )}

          {/* -------- Ziel-Liste -------- */}
          <section className="deploy__section">
            <div className="deploy__section-head">
              <h3 className="deploy__section-title">Deploy-Ziele</h3>
              <button type="button" className="btn deploy__mini" onClick={openNew} disabled={busy}>
                Neues Ziel
              </button>
            </div>

            {deploy.loading ? (
              <p className="deploy__hint">Lade Ziele …</p>
            ) : deploy.targets.length === 0 ? (
              <p className="deploy__hint">
                Noch kein Ziel angelegt. Trag deinen Webspace ein (SFTP oder FTP/FTPS), um zu
                veröffentlichen.
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
                        {target.hasCredentials ? '' : ' · kein Passwort hinterlegt'}
                        {target.lastDeployedCommit !== undefined
                          ? ` · zuletzt ${target.lastDeployedCommit.slice(0, 7)}`
                          : ' · nie deployt'}
                      </span>
                    </button>
                    <div className="deploy__target-actions">
                      <button
                        type="button"
                        className="btn deploy__mini"
                        onClick={() => openEdit(target)}
                        disabled={busy}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="btn deploy__mini"
                        onClick={() => void removeTarget(target)}
                        disabled={busy}
                      >
                        Entfernen
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

          {/* -------- Formular (anlegen/bearbeiten) -------- */}
          {form !== null && (
            <form
              className="deploy__form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitForm();
              }}
            >
              <h3 className="deploy__section-title">
                {form.id !== undefined ? 'Ziel bearbeiten' : 'Neues Ziel'}
              </h3>

              <label className="field">
                <span className="field__label">Name</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.name}
                  placeholder="z. B. IONOS Vereinsseite"
                  onChange={(e) => setField('name', e.target.value)}
                />
              </label>

              <div className="deploy__row">
                <label className="field">
                  <span className="field__label">Protokoll</span>
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
                <span className="field__label">Benutzername</span>
                <input
                  className="field__input"
                  type="text"
                  value={form.username}
                  autoComplete="off"
                  onChange={(e) => setField('username', e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Zielverzeichnis</span>
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
                  Passwort
                  {form.id !== undefined && (
                    <span className="field__hint deploy__inline-hint"> (leer = unverändert)</span>
                  )}
                </span>
                <input
                  className="field__input"
                  type="password"
                  value={form.password}
                  autoComplete="off"
                  placeholder={form.id !== undefined ? '•••••••• (unverändert lassen)' : 'Passwort'}
                  onChange={(e) => setField('password', e.target.value)}
                />
                <span className="field__hint">
                  {keychainAvailable
                    ? 'Das Passwort liegt im Systemschlüsselbund, nie im Klartext auf der Platte, und wird nie an die Oberfläche zurückgegeben.'
                    : 'Ohne Systemschlüsselbund bleibt das Passwort nur für diese Sitzung im Speicher.'}
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
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={saving || formError !== null}
                >
                  {saving ? 'Speichern …' : 'Speichern'}
                </button>
              </div>
            </form>
          )}

          {/* -------- Aktives Ziel: testen + veröffentlichen -------- */}
          {selected !== null && form === null && (
            <section className="deploy__section">
              <h3 className="deploy__section-title">
                Aktiv: <span className="deploy__mono">{selected.name}</span>
              </h3>

              {deploy.drift?.drift === true && (
                <p className="form-warning" role="status">
                  Der Stand auf dem Server weicht von dem ab, was wir zuletzt deployt haben
                  {deploy.drift.remoteSha !== null
                    ? ` (Server: ${deploy.drift.remoteSha.slice(0, 7)})`
                    : ' (auf dem Server liegt kein von uns deployter Stand)'}
                  . Ein Veröffentlichen überschreibt ihn.
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
                  {deploy.testing ? 'Teste …' : 'Verbindung testen'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void deploy.publish()}
                  disabled={busy || !selected.hasCredentials}
                >
                  <Icon name="deploy" size={14} />
                  {busy && deploy.rollbackSha === null ? 'Veröffentliche …' : 'Veröffentlichen'}
                </button>
              </div>

              {!selected.hasCredentials && (
                <p className="deploy__hint">
                  Für dieses Ziel ist noch kein Passwort hinterlegt — trag es über „Bearbeiten" ein.
                </p>
              )}

              {deploy.testResult !== null && <TestReport result={deploy.testResult} />}

              {(deploy.deploying || deploy.progress.phase !== 'idle') && (
                <ProgressReport progress={deploy.progress} rollbackSha={deploy.rollbackSha} />
              )}

              {/* Fehler VOR dem ersten Progress-Event (z. B. „Ziel nicht gefunden")
                  erzeugen keinen ProgressReport — ohne diese Zeile blieben sie
                  unsichtbar (outcome wurde gesetzt, aber nie gerendert). */}
              {deploy.outcome?.status === 'error' && deploy.progress.phase === 'idle' && (
                <p className="form-error" role="alert">
                  {deploy.outcome.message}
                </p>
              )}
            </section>
          )}

          {/* -------- Historie -------- */}
          <section className="deploy__section">
            <h3 className="deploy__section-title">Historie</h3>
            {deploy.history.length === 0 ? (
              <p className="deploy__hint">Noch nichts veröffentlicht.</p>
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
                      {!record.ok && <span className="deploy__badge-fail">fehlgeschlagen</span>}
                    </span>
                    <span className="deploy__history-meta">
                      {formatTime(record.at)}
                      {record.ok
                        ? ` · ${record.uploaded} hoch · ${record.deleted} gelöscht · ${formatBytes(record.bytesUploaded)}`
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
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Unterkomponenten ---------------- */

function TestReport({ result }: { result: DeployHook['testResult'] }): React.JSX.Element | null {
  if (result === null) return null;
  return (
    <div className={result.ok ? 'deploy__test deploy__test--ok' : 'deploy__test deploy__test--fail'}>
      <p className="deploy__test-title">
        <Icon name={result.ok ? 'check' : 'alert'} size={14} />
        {result.ok ? 'Verbindung steht' : 'Verbindung fehlgeschlagen'}
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
        {rollbackSha !== null ? `Rollback auf ${rollbackSha.slice(0, 7)} — ` : ''}
        {label}
      </p>
      {progress.currentFile !== null && (
        <p className="deploy__mono deploy__progress-file">{progress.currentFile}</p>
      )}
      <p className="deploy__progress-counts">
        {uploadLine !== null && <span>Hochgeladen: {uploadLine}</span>}
        {deleteLine !== null && <span>Gelöscht: {deleteLine}</span>}
        {progress.phase === 'done' && progress.result !== null && (
          <span>
            Fertig — {progress.result.uploaded} hoch · {progress.result.deleted} gelöscht ·{' '}
            {progress.result.unchanged} unverändert · {formatBytes(progress.result.bytesUploaded)}
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
  idle: 'Bereit',
  connecting: 'Verbinde …',
  planning: 'Ermittle Änderungen …',
  ensuring: 'Lege Verzeichnisse an …',
  uploading: 'Lade hoch …',
  deleting: 'Räume auf …',
  finalizing: 'Schreibe Manifest …',
  done: 'Veröffentlicht',
  error: 'Fehler',
};

/* ---------------- Helfer ---------------- */

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
  // Passwort/Passphrase nur mitschicken, wenn getippt (leer = unverändert).
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
  return new Date(t).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
