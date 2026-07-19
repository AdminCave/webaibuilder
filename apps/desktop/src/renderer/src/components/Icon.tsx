/**
 * Zentrale Icon-Komponente (AP3): monochrom (`currentColor`), Strichstärke 1.5
 * passend zur Hairline-Ästhetik des DS. Dekorative Icons sind automatisch
 * `aria-hidden`; wer ein bedeutungstragendes Icon rendert, gibt `aria-label`.
 * Die Icon-Quelle ist hinter der Registry (icons.ts) austauschbar.
 */

import { ICONS, type IconName } from './icons';

export function Icon({
  name,
  size = 16,
  className,
  'aria-label': ariaLabel,
}: {
  name: IconName;
  size?: number;
  className?: string;
  'aria-label'?: string;
}): React.JSX.Element {
  const Component = ICONS[name];
  return (
    <Component
      size={size}
      strokeWidth={1.5}
      {...(className !== undefined ? { className } : {})}
      {...(ariaLabel !== undefined
        ? { 'aria-label': ariaLabel, role: 'img' }
        : { 'aria-hidden': true })}
    />
  );
}
