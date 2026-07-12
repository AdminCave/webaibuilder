import { join } from 'node:path';

import { BrowserWindow, app } from 'electron';

import { getAppSession } from './appSession';
import { installErrorReporting } from './errorReporting';
import { registerIpcHandlers } from './ipc';
import { initLogger } from './logger';
import { logsDir } from './paths';
import { devRendererUrl, hardenWebContents, installPermissionHandlers } from './security';
import { initUpdater } from './updater';

// Fehlerberichte so früh wie möglich verdrahten (M5, PLAN §1/§6): lokaler,
// rotierender Datei-Logger + process-/app-Fehler-Hooks. Rein lokal, kein Remote.
// `app.getPath('userData')` ist im Main-Prozess schon vor `ready` verfügbar.
const logger = initLogger(logsDir());
installErrorReporting(logger);

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Web AI Builder',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Hardening (PLAN §4, Sicherheit) — explizit, auch wo es Default ist.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  // Der Main-Prozess streamt Preview-/Agent-/Checkpoint-Events an dieses Fenster.
  getAppSession().setWindow(win);

  // Auto-Update (M5): prüft/lädt im Hintergrund, meldet den Status an dieses
  // Fenster; No-op im Dev (siehe updater.ts).
  initUpdater(win);

  win.once('ready-to-show', () => win.show());

  // Headless-Smoke-Test (CI/Umgebungen ohne Display): sauber beenden,
  // sobald der Renderer geladen ist.
  if (process.env['WAB_SMOKE'] === '1') {
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] Renderer geladen — beende.');
      app.quit();
    });
  }

  const dev = devRendererUrl();
  if (!app.isPackaged && dev !== undefined) {
    void win.loadURL(dev);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Härtung gilt für JEDEN WebContents, auch künftig erzeugte.
app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

void app.whenReady().then(() => {
  installPermissionHandlers();
  registerIpcHandlers();
  if (process.env['WAB_SMOKE'] === '1') {
    console.log('[smoke] App bereit — Security-Handler und IPC registriert.');
  }
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Preview-Server, Watcher und laufende Turns sauber herunterfahren.
app.on('before-quit', () => {
  try {
    void getAppSession().closeProject();
  } catch {
    // Session noch nicht initialisiert (sehr früher Quit) — nichts zu schließen.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
