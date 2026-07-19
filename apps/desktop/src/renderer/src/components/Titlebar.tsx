import type { Theme } from '../App';
import { Icon } from './Icon';

interface TitlebarProps {
  swapped: boolean;
  onSwap: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** Name of the open project; undefined = start view. */
  projectName?: string | undefined;
  /** Back to the project overview; undefined = hide button. */
  onShowProjects?: (() => void) | undefined;
  /** Opens the backend settings. */
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
      <span className="titlebar__project">{projectName ?? 'No project open'}</span>
      <div className="titlebar__actions">
        {onShowProjects !== undefined && (
          <button
            type="button"
            className="btn"
            title="Back to projects"
            onClick={onShowProjects}
          >
            <Icon name="folder" />
            Projects
          </button>
        )}
        <button
          type="button"
          className="btn"
          aria-pressed={swapped}
          title="Swap chat and preview panels"
          onClick={onSwap}
        >
          <Icon name="swap" />
          Swap panels
        </button>
        <button
          type="button"
          className="btn"
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          type="button"
          className="btn"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
        >
          <Icon name="settings" />
          Settings
        </button>
      </div>
    </header>
  );
}
