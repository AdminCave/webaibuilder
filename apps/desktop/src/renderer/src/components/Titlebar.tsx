import type { Theme } from '../App';
import { Icon } from './Icon';

interface TitlebarProps {
  swapped: boolean;
  onSwap: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** Name des geöffneten Projekts; undefined = Startansicht. */
  projectName?: string | undefined;
  /** Zurück zur Projektübersicht; undefined = Button ausblenden. */
  onShowProjects?: (() => void) | undefined;
  /** Öffnet die Backend-Einstellungen. */
  onOpenSettings: () => void;
}

export function Titlebar({
  swapped,
  onSwap,
  theme,
  onToggleTheme,
  projectName,
  onShowProjects,
  onOpenSettings,
}: TitlebarProps): React.JSX.Element {
  return (
    <header className="titlebar">
      <span className="titlebar__brand">Web AI Builder</span>
      <span className="titlebar__project">{projectName ?? 'Kein Projekt geöffnet'}</span>
      <div className="titlebar__actions">
        {onShowProjects !== undefined && (
          <button
            type="button"
            className="btn"
            title="Zur Projektübersicht"
            onClick={onShowProjects}
          >
            <Icon name="folder" />
            Projekte
          </button>
        )}
        <button
          type="button"
          className="btn"
          aria-pressed={swapped}
          title="Chat- und Vorschau-Panel tauschen"
          onClick={onSwap}
        >
          <Icon name="swap" />
          Panels tauschen
        </button>
        <button
          type="button"
          className="btn"
          title={theme === 'dark' ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln'}
          onClick={onToggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          {theme === 'dark' ? 'Hell' : 'Dunkel'}
        </button>
        <button
          type="button"
          className="btn"
          title="Einstellungen (Strg+,)"
          onClick={onOpenSettings}
        >
          <Icon name="settings" />
          Einstellungen
        </button>
      </div>
    </header>
  );
}
