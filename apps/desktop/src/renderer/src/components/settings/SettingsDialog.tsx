/**
 * Einstellungen (PLAN §6, Redesign): Modal mit Seitennavigation statt einer
 * langen Scroll-Liste. Drei Sektionen — „KI & Backends" (EIN einheitlicher
 * Aktivierungsweg für alle sechs Backends), „Darstellung" (Theme) und
 * „Hilfe & Logs". Deep-Link-fähig über `route` (z. B. aus dem Chat-Empty-State
 * direkt auf die byok-Karte). Jede Aktion speichert sofort — es gibt keinen
 * globalen „Speichern"-Knopf mehr.
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
  /** Startet den Einführungs-Flow erneut (schließt den Dialog). */
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

  // Deep-Link-Änderungen von außen übernehmen (z. B. Chat-Empty-State).
  useEffect(() => {
    setSection(route.section);
  }, [route]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide modal__panel--settings">
        <header className="modal__header modal__header--split">
          <h2 className="modal__title">Einstellungen</h2>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onClose}
            title="Einstellungen schließen"
          >
            <Icon name="close" aria-label="Einstellungen schließen" />
          </button>
        </header>

        <div className="settings">
          <nav className="settings__nav" aria-label="Einstellungs-Kategorien">
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
