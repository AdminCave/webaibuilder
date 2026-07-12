import { useEffect, useState } from 'react';

import type { Project, StarterTemplate } from '@webaibuilder/core';

interface StartScreenProps {
  projects: Project[];
  templates: StarterTemplate[];
  onOpen: (project: Project) => void;
  onCreated: (project: Project) => void;
}

/**
 * Startansicht ohne geöffnetes Projekt: vorhandene Projekte öffnen oder ein
 * neues aus einer Starter-Vorlage anlegen (M1 — bewusst minimal, kein Wizard).
 */
export function StartScreen({
  projects,
  templates,
  onOpen,
  onCreated,
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
                {templates.length === 0 && <p className="start__hint">Keine Vorlagen gefunden.</p>}
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

        {projects.length > 0 && (
          <section className="start__card">
            <h2 className="start__title">Deine Projekte</h2>
            <ul className="project-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <button type="button" className="project-card" onClick={() => onOpen(project)}>
                    <span className="project-card__name">{project.name}</span>
                    <span className="project-card__path">{project.workspaceDir}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
