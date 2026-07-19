import { join } from 'node:path';

import { BrowserWindow, app, dialog } from 'electron';

import { getAppSession } from './appSession';
import { installErrorReporting } from './errorReporting';
import { registerIpcHandlers } from './ipc';
import { initLogger } from './logger';
import { logsDir } from './paths';
import { devRendererUrl, hardenWebContents, installPermissionHandlers } from './security';
import { initUpdater } from './updater';

// Wire up error reporting as early as possible (M5, PLAN §1/§6): a local,
// rotating file logger + process/app error hooks. Purely local, no remote.
// `app.getPath('userData')` is available in the main process before `ready`.
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
    // Window/taskbar icon in dev mode (build/icon.png, AdminCave brand).
    // In the packaged build, electron-builder sets the app icon itself.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Hardening (PLAN §4, security) — explicit, even where it is the default.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  // The main process streams preview/agent/checkpoint events to this window.
  getAppSession().setWindow(win);

  // Auto-update (M5): checks/downloads in the background, reports status to this
  // window; no-op in dev (see updater.ts).
  initUpdater(win);

  win.once('ready-to-show', () => win.show());

  // Headless smoke test (CI/environments without a display): exit cleanly
  // as soon as the renderer has loaded.
  if (process.env['WAB_SMOKE'] === '1') {
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] Renderer loaded — exiting.');
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

// Hardening applies to EVERY WebContents, including those created in the future.
app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

// If initialization fails (e.g. a corrupt registry DB or a native module with
// the wrong ABI), there would otherwise never be a window and no message —
// the process would just sit there silently. So: log the error, show it to the
// user, and exit.
function failStartup(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  logger.error('startup', 'App startup failed', { detail });
  console.error('[startup] App startup failed:', detail);
  if (process.env['WAB_SMOKE'] !== '1') {
    dialog.showErrorBox(
      'Web AI Builder could not start',
      `An error occurred during startup:\n\n${detail}\n\nLogs: ${logsDir()}`,
    );
  }
  app.exit(1);
}

void app.whenReady().then(() => {
  try {
    installPermissionHandlers();
    registerIpcHandlers();
    if (process.env['WAB_SMOKE'] === '1') {
      console.log('[smoke] App ready — security handlers and IPC registered.');
    }
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  } catch (error) {
    failStartup(error);
  }
}, failStartup);

// Cleanly shut down the preview server, watchers, and any running turns.
app.on('before-quit', () => {
  try {
    void getAppSession().closeProject();
  } catch {
    // Session not yet initialized (very early quit) — nothing to close.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
