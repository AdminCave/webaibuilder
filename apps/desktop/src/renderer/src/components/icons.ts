/**
 * Icon registry — the ONLY swap layer between the app and the icon source
 * (currently lucide-react: MIT, monochrome line icons, matching the hairline
 * aesthetic of the AdminCave DS). If custom DS icons arrive later, only this
 * file changes — all call sites (<Icon name="…">) stay the same.
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
