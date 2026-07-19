import { useEffect, useState } from 'react';

import type { Project, StarterTemplate } from '@webaibuilder/core';

interface StartScreenProps {
  projects: Project[];
  /** Projektliste konnte nicht geladen werden (sieht sonst wie „leer" aus). */
  projectsError: boolean;
  onRetryProjects: () => void;
  templates: StarterTemplate[];
  /** Vorlagen konnten nicht geladen werden — sonst bleibt „Anlegen" stumm tot. */
  templatesError: boolean;
  onRetryTemplates: () => void;
  onOpen: (project: Project) => void;
  onCreated: (project: Project) => void;
  onRename: (projectId: string, name: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}

/**
 * Startansicht ohne geöffnetes Projekt: vorhandene Projekte öffnen, umbenennen
 * oder aus der Liste entfernen, und neue aus einer Starter-Vorlage anlegen.
 */
export function StartScreen({
  projects,
  projectsError,
  onRetryProjects,
  templates,
  templatesError,
  onRetryTemplates,
  onOpen,
  onCreated,
  onRename,
  onDelete,
}: StartScreenProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Erste Vorlage vorauswählen, sobald die Liste da ist.
  useEffect(() => {
    if (templateId === '' && templates.length > 0) {
      setTemplateId(templates[0]?.id ?? '');
    }
  }, [templates, templateId]);

  const canSubmit = !busy && name.trim() !== '' && templateId !== '';

  async function createProject(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const project = await window.wab.projects.create({ name: name.trim(), templateId });
      setName('');
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das Projekt konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start" aria-label="Projekte">
      <div className="start__inner">
        <section className="start__card">
          <h1 className="start__title">Neues Projekt</h1>
          <p className="start__hint">
            Gib deinem Projekt einen Namen und wähl eine Vorlage — alles Weitere änderst du später
            per Chat.
          </p>

          <form
            className="start__form"
            onSubmit={(e) => {
              e.preventDefault();
              void createProject();
            }}
          >
            <label className="field">
              <span className="field__label">Projektname</span>
              <input
                className="field__input"
                type="text"
                value={name}
                placeholder="z. B. Vereinsseite"
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <fieldset className="tpl">
              <legend className="field__label">Vorlage</legend>
              <div className="tpl__grid" role="radiogroup" aria-label="Vorlage wählen">
                {templates.map((tpl) => (
                  <label
                    key={tpl.id}
                    className={
                      templateId === tpl.id ? 'tpl__option tpl__option--selected' : 'tpl__option'
                    }
                  >
                    <input
                      className="tpl__radio"
                      type="radio"
                      name="template"
                      value={tpl.id}
                      checked={templateId === tpl.id}
                      onChange={() => setTemplateId(tpl.id)}
                    />
                    <span className="tpl__name">{tpl.name}</span>
                    <span className="tpl__description">{tpl.description}</span>
                  </label>
                ))}
                {templates.length === 0 &&
                  (templatesError ? (
                    <p className="form-error" role="alert">
                      Vorlagen konnten nicht geladen werden.{' '}
                      <button type="button" className="backend-link" onClick={onRetryTemplates}>
                        Erneut versuchen
                      </button>
                    </p>
                  ) : (
                    <p className="start__hint">Keine Vorlagen gefunden.</p>
                  ))}
              </div>
            </fieldset>

            {error !== null && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="start__actions">
              <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                {busy ? 'Wird angelegt …' : 'Projekt anlegen'}
              </button>
            </div>
          </form>
        </section>

        {(projects.length > 0 || projectsError) && (
          <section className="start__card">
            <h2 className="start__title">Deine Projekte</h2>
            {projectsError && (
              <p className="form-error" role="alert">
                Deine Projekte konnten nicht geladen werden.{' '}
                <button type="button" className="backend-link" onClick={onRetryProjects}>
                  Erneut versuchen
                </button>
              </p>
            )}
            <ul className="project-list">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onOpen={onOpen}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * Projektkarte mit Aktionen: Öffnen, Umbenennen (inline), aus der Liste
 * entfernen (mit Bestätigung — der Workspace-Ordner bleibt auf der Platte).
 * `projects.update/delete` waren komplett verdrahtet, es fehlte nur die UI.
 */
function ProjectRow({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: Project;
  onOpen: (project: Project) => void;
  onRename: (projectId: string, name: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}): React.JSX.Element {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view');
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitRename(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === project.name) {
      setName(project.name);
      setMode('view');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(project.id, trimmed);
      setMode('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onDelete(project.id);
      // Die Zeile verschwindet mit dem State-Update in App — nichts zurückzusetzen.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Entfernen fehlgeschlagen.');
      setBusy(false);
    }
  }

  return (
    <li className="project-item">
      <button type="button" className="project-card" onClick={() => onOpen(project)}>
        <span className="project-card__name">{project.name}</span>
        <span className="project-card__path">{project.workspaceDir}</span>
      </button>

      <div className="project-item__actions">
        {mode === 'view' && (
          <>
            <button type="button" className="backend-link" onClick={() => setMode('rename')}>
              Umbenennen
            </button>
            <button
              type="button"
              className="backend-link backend-link--danger"
              onClick={() => setMode('confirm-delete')}
            >
              Entfernen
            </button>
          </>
        )}

        {mode === 'rename' && (
          <form
            className="project-item__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRename();
            }}
          >
            <input
              className="field__input"
              type="text"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn" disabled={busy || name.trim() === ''}>
              {busy ? 'Speichere …' : 'Speichern'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setName(project.name);
                setMode('view');
              }}
            >
              Abbrechen
            </button>
          </form>
        )}

        {mode === 'confirm-delete' && (
          <>
            <span className="project-item__confirm">
              Aus der Liste entfernen? Der Projektordner bleibt auf der Platte.
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void submitDelete()}
            >
              {busy ? 'Entferne …' : 'Ja, entfernen'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode('view')}>
              Abbrechen
            </button>
          </>
        )}
      </div>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
