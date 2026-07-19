/**
 * Icon-Registry — die EINZIGE Austausch-Schicht zwischen App und Icon-Quelle
 * (aktuell lucide-react: MIT, monochrome Strich-Icons, passend zur Hairline-
 * Ästhetik des AdminCave-DS). Sollen später eigene DS-Icons kommen, ändert
 * sich nur diese Datei — alle Aufrufstellen (<Icon name="…">) bleiben gleich.
 */

import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CloudUpload,
  Copy,
  Cpu,
  ExternalLink,
  Folder,
  History,
  Info,
  KeyRound,
  LoaderCircle,
  Moon,
  Plug,
  RotateCw,
  SendHorizontal,
  Settings,
  Square,
  Sun,
  Terminal,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'settings'
  | 'sun'
  | 'moon'
  | 'swap'
  | 'folder'
  | 'refresh'
  | 'close'
  | 'check'
  | 'alert'
  | 'info'
  | 'chevron-down'
  | 'chevron-right'
  | 'external'
  | 'deploy'
  | 'history'
  | 'key'
  | 'terminal'
  | 'cpu'
  | 'plug'
  | 'send'
  | 'stop'
  | 'copy'
  | 'dot'
  | 'spinner';

export const ICONS: Record<IconName, LucideIcon> = {
  settings: Settings,
  sun: Sun,
  moon: Moon,
  swap: ArrowLeftRight,
  folder: Folder,
  refresh: RotateCw,
  close: X,
  check: Check,
  alert: TriangleAlert,
  info: Info,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  external: ExternalLink,
  deploy: CloudUpload,
  history: History,
  key: KeyRound,
  terminal: Terminal,
  cpu: Cpu,
  plug: Plug,
  send: SendHorizontal,
  stop: Square,
  copy: Copy,
  dot: Circle,
  spinner: LoaderCircle,
};
