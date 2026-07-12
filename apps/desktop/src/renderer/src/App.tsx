import { useEffect, useState } from 'react';

import type { PingResult, Project, StarterTemplate } from '@webaibuilder/core';

import { ChatPanel } from './components/ChatPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { StartScreen } from './components/StartScreen';
import { StatusBar } from './components/StatusBar';
import { TimelineSidebar } from './components/TimelineSidebar';
import { Titlebar } from './components/Titlebar';

export type Theme = 'dark' | 'light';

export function App(): React.JSX.Element {
  const [swapped, setSwapped] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark',
  );
  const [ping, setPing] = useState<PingResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<StarterTemplate[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.dataset['theme'] = 'light';
    } else {
      delete document.documentElement.dataset['theme'];
    }
    localStorage.setItem('wab:theme', theme);
  }, [theme]);

  useEffect(() => {
    window.wab
      .ping()
      .then(setPing)
      .catch(() => setPing(null));
    window.wab.projects
      .list()
      .then(setProjects)
      .catch(() => setProjects([]));
    window.wab.templates
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  return (
    <div className="app">
      <Titlebar
        swapped={swapped}
        onSwap={() => setSwapped((s) => !s)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        projectName={activeProject?.name}
        onShowProjects={activeProject === null ? undefined : () => setActiveProject(null)}
      />
      {activeProject === null ? (
        <StartScreen
          projects={projects}
          templates={templates}
          onOpen={setActiveProject}
          onCreated={(project) => {
            setProjects((prev) => [project, ...prev]);
            setActiveProject(project);
          }}
        />
      ) : (
        <main className={swapped ? 'workbench workbench--swapped' : 'workbench'}>
          <ChatPanel />
          <PreviewPanel theme={theme} />
          <TimelineSidebar />
        </main>
      )}
      <StatusBar ping={ping} />
    </div>
  );
}
