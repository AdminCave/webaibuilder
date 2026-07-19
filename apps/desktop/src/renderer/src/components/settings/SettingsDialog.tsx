/**
 * Settings (PLAN §6, redesign): modal with side navigation instead of one long
 * scroll list. Three sections — "AI & Backends" (ONE unified activation path
 * for all six backends), "Appearance" (theme), and "Help & Logs". Deep-link
 * capable via `route` (e.g. from the chat empty state straight to the byok
 * card). Every action saves immediately — there is no longer a global "Save"
 * button.
 */

import { useEffect, useState } from 'react';

import type { AgentSettings } from '../../../../shared/settings';
import {
  SETTINGS_SECTIONS,
  type SettingsRoute,
  type SettingsSection,
} from '../../../../shared/settingsNav';
import type { Theme } from '../../App';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { AppearanceSection } from './AppearanceSection';
import { BackendsSection } from './BackendsSection';
import { HelpSection } from './HelpSection';

const SECTION_ICON: Record<SettingsSection, IconName> = {
  backends: 'cpu',
  appearance: 'sun',
  help: 'info',
};

interface SettingsDialogProps {
  route: SettingsRoute;
  settings: AgentSettings | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
  onSaved: (settings: AgentSettings) => void;
  /** Restarts the intro flow (closes the dialog). */
  onReplayOnboarding: () => void;
}

export function SettingsDialog({
  route,
  settings,
  theme,
  onThemeChange,
  onClose,
  onSaved,
  onReplayOnboarding,
}: SettingsDialogProps): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>(route.section);

  // Adopt deep-link changes from outside (e.g. chat empty state).
  useEffect(() => {
    setSection(route.section);
  }, [route]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide modal__panel--settings">
        <header className="modal__header modal__header--split">
          <h2 className="modal__title">Settings</h2>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onClose}
            title="Close settings"
          >
            <Icon name="close" aria-label="Close settings" />
          </button>
        </header>

        <div className="settings">
          <nav className="settings__nav" aria-label="Settings categories">
            {SETTINGS_SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={
                  section === entry.id
                    ? 'settings__nav-item settings__nav-item--active'
                    : 'settings__nav-item'
                }
                aria-current={section === entry.id ? 'page' : undefined}
                onClick={() => setSection(entry.id)}
              >
                <Icon name={SECTION_ICON[entry.id]} />
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="settings__content">
            {section === 'backends' && (
              <BackendsSection
                settings={settings}
                {...(route.backendId !== undefined ? { focusBackendId: route.backendId } : {})}
                onSaved={onSaved}
              />
            )}
            {section === 'appearance' && (
              <AppearanceSection theme={theme} onThemeChange={onThemeChange} />
            )}
            {section === 'help' && <HelpSection onReplayOnboarding={onReplayOnboarding} />}
          </div>
        </div>
      </div>
    </div>
  );
}
