/**
 * Central icon component (AP3): monochrome (`currentColor`), stroke width 1.5
 * matching the DS's hairline aesthetic. Decorative icons are automatically
 * `aria-hidden`; render a meaningful icon by passing `aria-label`.
 * The icon source is swappable behind the registry (icons.ts).
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
