/**
 * Sektion „Darstellung": Theme-Wahl (Dunkel/Hell). Die Quelle der Wahrheit
 * bleibt der App-State + localStorage 'wab:theme' — der Titlebar-Toggle bleibt
 * als Schnellzugriff bestehen; hier ist der auffindbare Ort dafür.
 */

import type { Theme } from '../../App';

const THEMES: readonly { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dunkel', hint: 'Schwarz mit Hairlines — der Standard.' },
  { id: 'light', label: 'Hell', hint: 'Weiß, gleiche Struktur.' },
];

export function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}): React.JSX.Element {
  return (
    <section aria-label="Darstellung" className="appearance">
      <fieldset className="tpl">
        <legend className="field__label">Erscheinungsbild</legend>
        <div className="tpl__grid" role="radiogroup" aria-label="Theme wählen">
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
        Die Wahl wird lokal gespeichert und gilt sofort. Der Schnell-Umschalter oben in der
        Titelleiste bleibt zusätzlich verfügbar.
      </p>
    </section>
  );
}
