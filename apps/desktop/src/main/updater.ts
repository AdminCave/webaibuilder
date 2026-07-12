/**
 * Auto-Update (M5, PLAN §6) — electron-updater gegen GitHub Releases.
 *
 * Verhalten: beim Start und danach periodisch auf Updates prüfen, im Hintergrund
 * herunterladen, den Renderer über den Status informieren und beim Beenden
 * anwenden. Der Feed kommt aus der von electron-builder generierten
 * `app-update.yml` (publish: github, AdminCave/webaibuilder).
 *
 * Sicherheitshaltung (M0): der einzige renderer→main-Kanal hier
 * (`update:restart`) läuft hinter der Sender-Validierung. Kein nodeIntegration,
 * keine zusätzliche Angriffsfläche — der Renderer bekommt nur Status-Pushes und
 * darf genau eine Aktion auslösen (neu starten).
 *
 * Dev-Guard: `!app.isPackaged` → echter Updater bleibt aus (electron-updater
 * hätte im Dev keine `app-update.yml` und würde werfen). Der IPC-Handler wird
 * trotzdem registriert, damit ein „restart"-Aufruf nie ins Leere läuft.
 */

import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

import { DesktopIpcChannels, DesktopIpcEvents, type UpdateStatus } from '../shared/channels';
import { isTrustedIpcSender } from './security';

/** Prüf-Intervall nach dem Start (electron-updater lädt automatisch nach). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 Stunden

let initialized = false;
let targetWindow: BrowserWindow | null = null;
/** Version des gefundenen Updates — für Fortschritts-/Ready-Meldungen. */
let pendingVersion = '';

/** Push des aktuellen Update-Status an das aktive Fenster (falls vorhanden). */
function pushStatus(status: UpdateStatus): void {
  const win = targetWindow;
  if (win !== null && !win.isDestroyed()) {
    win.webContents.send(DesktopIpcEvents.update, status);
  }
}

/** Registriert die „jetzt neu starten"-Aktion (immer, auch im Dev = No-op). */
function registerRestartHandler(): void {
  ipcMain.handle(DesktopIpcChannels.updateRestart, (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error(
        'IPC-Aufruf auf "update:restart" von nicht vertrauenswürdigem Absender blockiert.',
      );
    }
    if (!app.isPackaged) return; // Dev: kein anwendbares Update.
    // isSilent=false (Installer sichtbar auf Windows), isForceRunAfter=true.
    autoUpdater.quitAndInstall(false, true);
  });
}

/** Verdrahtet die electron-updater-Events auf Status-Pushes. */
function wireAutoUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => pushStatus({ phase: 'checking' }));

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    pendingVersion = info.version;
    pushStatus({ phase: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => pushStatus({ phase: 'not-available' }));

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    pushStatus({
      phase: 'downloading',
      version: pendingVersion,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    pendingVersion = info.version;
    pushStatus({ phase: 'ready', version: info.version });
  });

  autoUpdater.on('error', (error: Error) => {
    pushStatus({ phase: 'error', message: error.message });
  });
}

/** Startet eine Prüfung; Fehler landen im 'error'-Event (nie unhandled). */
function checkNow(): void {
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    pushStatus({ phase: 'error', message });
  });
}

/**
 * Initialisiert den Updater und bindet ihn an das (aktuelle) Hauptfenster.
 * Idempotent: mehrfacher Aufruf (z. B. macOS-`activate`) aktualisiert nur die
 * Fenster-Referenz; Listener/Handler/Intervall werden genau einmal aufgesetzt.
 */
export function initUpdater(win: BrowserWindow): void {
  targetWindow = win;
  if (initialized) return;
  initialized = true;

  registerRestartHandler();

  // Dev/ungepackt: kein echter Update-Feed → nur der No-op-Handler oben.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true; // im Hintergrund laden
  autoUpdater.autoInstallOnAppQuit = true; // beim Beenden anwenden

  wireAutoUpdaterEvents();

  checkNow();
  const timer = setInterval(checkNow, CHECK_INTERVAL_MS);
  // Intervall soll den Prozess nicht am Leben halten.
  timer.unref?.();
}
