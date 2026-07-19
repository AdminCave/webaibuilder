/**
 * "Appearance" section: theme choice (Dark/Light). The source of truth stays
 * the app state + localStorage 'wab:theme' — the titlebar toggle remains as a
 * quick access; this is the discoverable place for it.
 */

import type { Theme } from '../../App';

const THEMES: readonly { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Black with hairlines — the default.' },
  { id: 'light', label: 'Light', hint: 'White, same structure.' },
];

export function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}): React.JSX.Element {
  return (
    <section aria-label="Appearance" className="appearance">
      <fieldset className="tpl">
        <legend className="field__label">Theme</legend>
        <div className="tpl__grid" role="radiogroup" aria-label="Choose theme">
          {THEMES.map((option) => (
            <label
              key={option.id}
              className={theme === option.id ? 'tpl__option tpl__option--selected' : 'tpl__option'}
            >
              <input
                className="tpl__radio"
                type="radio"
                name="theme"
                value={option.id}
                checked={theme === option.id}
                onChange={() => onThemeChange(option.id)}
              />
              <span className="tpl__name">{option.label}</span>
              <span className="tpl__description">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="field__hint">
        The choice is saved locally and applies immediately. The quick toggle at the top of the
        title bar also remains available.
      </p>
    </section>
  );
}
