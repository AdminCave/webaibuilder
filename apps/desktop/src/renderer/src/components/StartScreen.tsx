import { useEffect, useState } from 'react';

import type { Project, StarterTemplate } from '@webaibuilder/core';

interface StartScreenProps {
  projects: Project[];
  /** Project list could not be loaded (otherwise looks like "empty"). */
  projectsError: boolean;
  onRetryProjects: () => void;
  templates: StarterTemplate[];
  /** Templates could not be loaded — otherwise "Create" stays silently dead. */
  templatesError: boolean;
  onRetryTemplates: () => void;
  onOpen: (project: Project) => void;
  onCreated: (project: Project) => void;
  onRename: (projectId: string, name: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}

/**
 * Start view with no open project: open, rename, or remove existing projects
 * from the list, and create new ones from a starter template.
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

  // Preselect the first template as soon as the list is available.
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
      setError(err instanceof Error ? err.message : 'The project could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start" aria-label="Projects">
      <div className="start__inner">
        <section className="start__card">
          <h1 className="start__title">New project</h1>
          <p className="start__hint">
            Give your project a name and pick a template — you change everything else later via
            chat.
          </p>

          <form
            className="start__form"
            onSubmit={(e) => {
              e.preventDefault();
              void createProject();
            }}
          >
            <label className="field">
              <span className="field__label">Project name</span>
              <input
                className="field__input"
                type="text"
                value={name}
                placeholder="e.g. Club site"
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <fieldset className="tpl">
              <legend className="field__label">Template</legend>
              <div className="tpl__grid" role="radiogroup" aria-label="Choose template">
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
                      Templates could not be loaded.{' '}
                      <button type="button" className="backend-link" onClick={onRetryTemplates}>
                        Try again
                      </button>
                    </p>
                  ) : (
                    <p className="start__hint">No templates found.</p>
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
                {busy ? 'Creating …' : 'Create project'}
              </button>
            </div>
          </form>
        </section>

        {(projects.length > 0 || projectsError) && (
          <section className="start__card">
            <h2 className="start__title">Your projects</h2>
            {projectsError && (
              <p className="form-error" role="alert">
                Your projects could not be loaded.{' '}
                <button type="button" className="backend-link" onClick={onRetryProjects}>
                  Try again
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
 * Project card with actions: open, rename (inline), remove from the list (with
 * confirmation — the workspace folder stays on disk).
 * `projects.update/delete` were fully wired, only the UI was missing.
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
      setError(err instanceof Error ? err.message : 'Rename failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onDelete(project.id);
      // The row disappears with the state update in App — nothing to reset.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
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
              Rename
            </button>
            <button
              type="button"
              className="backend-link backend-link--danger"
              onClick={() => setMode('confirm-delete')}
            >
              Remove
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
              {busy ? 'Saving …' : 'Save'}
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
              Cancel
            </button>
          </form>
        )}

        {mode === 'confirm-delete' && (
          <>
            <span className="project-item__confirm">
              Remove from the list? The project folder stays on disk.
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void submitDelete()}
            >
              {busy ? 'Removing …' : 'Yes, remove'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode('view')}>
              Cancel
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
