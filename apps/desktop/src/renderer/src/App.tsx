import { useCallback, useEffect, useState } from 'react';

import type { PingResult, Project, StarterTemplate } from '@webaibuilder/core';

import { shouldShowOnboarding } from '../../shared/onboarding';
import type { AgentSettings } from '../../shared/settings';
import type { SettingsRoute } from '../../shared/settingsNav';
import { Onboarding } from './components/Onboarding';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { StartScreen } from './components/StartScreen';
import { StatusBar } from './components/StatusBar';
import { Titlebar } from './components/Titlebar';
import { UpdateNotice } from './components/UpdateNotice';
import { Workbench } from './components/Workbench';

export type Theme = 'dark' | 'light';

export function App(): React.JSX.Element {
  const [swapped, setSwapped] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark',
  );
  const [ping, setPing] = useState<PingResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState(false);
  const [templates, setTemplates] = useState<StarterTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  /** Open settings including deep-link target (null = closed). */
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.dataset['theme'] = 'light';
    } else {
      delete document.documentElement.dataset['theme'];
    }
    localStorage.setItem('wab:theme', theme);
  }, [theme]);

  // If loading fails, the chat would otherwise be silently and permanently
  // locked — hence a visible banner with retry instead of a mute `null`.
  const loadSettings = useCallback(() => {
    window.wab.settings
      .get()
      .then((next) => {
        setSettings(next);
        setSettingsError(false);
      })
      .catch(() => {
        setSettings(null);
        setSettingsError(true);
      });
  }, []);

  // Don't let a load error look like "no projects/templates" — the
  // StartScreen shows a message with "Try again" for that.
  const loadProjects = useCallback(() => {
    window.wab.projects
      .list()
      .then((list) => {
        setProjects(list);
        setProjectsError(false);
      })
      .catch(() => {
        setProjects([]);
        setProjectsError(true);
      });
  }, []);

  const loadTemplates = useCallback(() => {
    window.wab.templates
      .list()
      .then((list) => {
        setTemplates(list);
        setTemplatesError(false);
      })
      .catch(() => {
        setTemplates([]);
        setTemplatesError(true);
      });
  }, []);

  useEffect(() => {
    window.wab
      .ping()
      .then(setPing)
      .catch(() => setPing(null));
    loadProjects();
    loadTemplates();
    loadSettings();
    // Only show onboarding on first launch (fail-open: show on error).
    window.wab.onboarding
      .get()
      .then((state) => setShowOnboarding(shouldShowOnboarding(state)))
      .catch(() => setShowOnboarding(true));
  }, [loadSettings, loadProjects, loadTemplates]);

  // Rename/delete: the IPC channels were fully wired, only the UI was missing
  // (StartScreen project cards). Deleting only removes the registry entry —
  // the workspace folder is deliberately left in place (see registry.ts).
  const renameProject = useCallback(async (projectId: string, name: string) => {
    const updated = await window.wab.projects.update(projectId, { name });
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    await window.wab.projects.delete(projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  // Keyboard shortcut: Ctrl+,/Cmd+, opens settings, Escape closes them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsRoute((current) => current ?? { section: 'backends' });
      } else if (event.key === 'Escape') {
        setSettingsRoute(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function completeOnboarding(): void {
    setShowOnboarding(false);
    void window.wab.onboarding.set({ hasOnboarded: true }).catch(() => undefined);
  }

  return (
    <div className="app">
      <Titlebar
        swapped={swapped}
        onSwap={() => setSwapped((s) => !s)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        projectName={activeProject?.name}
        onShowProjects={activeProject === null ? undefined : () => setActiveProject(null)}
        onOpenSettings={() => setSettingsRoute({ section: 'backends' })}
      />
      {settingsError && (
        <div className="app__banner" role="alert">
          <span>Couldn't load settings — the chat stays locked until they load.</span>
          <button type="button" className="btn" onClick={loadSettings}>
            Try again
          </button>
        </div>
      )}
      {activeProject === null ? (
        <StartScreen
          projects={projects}
          projectsError={projectsError}
          onRetryProjects={loadProjects}
          templates={templates}
          templatesError={templatesError}
          onRetryTemplates={loadTemplates}
          onOpen={setActiveProject}
          onCreated={(project) => {
            setProjects((prev) => [project, ...prev]);
            setActiveProject(project);
          }}
          onRename={renameProject}
          onDelete={deleteProject}
        />
      ) : (
        <main className={swapped ? 'workbench workbench--swapped' : 'workbench'}>
          <Workbench
            project={activeProject}
            theme={theme}
            settings={settings}
            onCostChange={setCostUsd}
            onDeployStatusChange={setDeployStatus}
            onOpenSettings={setSettingsRoute}
            onSettingsSaved={setSettings}
          />
        </main>
      )}
      <StatusBar ping={ping} settings={settings} costUsd={costUsd} deployStatus={deployStatus} />

      <UpdateNotice />

      {showOnboarding && (
        <Onboarding
          onComplete={completeOnboarding}
          onOpenSettings={() => {
            completeOnboarding();
            setSettingsRoute({ section: 'backends' });
          }}
        />
      )}

      {settingsRoute !== null && (
        <SettingsDialog
          route={settingsRoute}
          settings={settings}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsRoute(null)}
          onSaved={(next) => setSettings(next)}
          onReplayOnboarding={() => {
            setSettingsRoute(null);
            setShowOnboarding(true);
          }}
        />
      )}
    </div>
  );
}
