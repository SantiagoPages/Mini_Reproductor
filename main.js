/**
 * Proceso principal de Electron.
 *
 * - Crea la ventana sin marco y administra la bandeja y las teclas multimedia.
 * - Sirve la interfaz por HTTP en loopback: Spotify exige una redirect URI http/https
 *   y el SDK de reproducción requiere un origen seguro.
 * - Expone por IPC solo las operaciones privilegiadas necesarias (sesión cifrada,
 *   navegador del sistema, portapapeles, ventana), validando cada argumento.
 *
 * La interfaz corre aislada: sandbox, contextIsolation y sin acceso a Node.
 */
/**
 * Electron main process. Hosts the loopback HTTP server (UI + OAuth redirect), the frameless window,
 * tray and media keys. Privileged operations are exposed over validated IPC only; the UI runs sandboxed,
 * with context isolation and no Node access.
 */
const { app, BrowserWindow, components, ipcMain, safeStorage, shell, session, dialog, clipboard, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
// Puerto fijo: debe coincidir con la redirect URI registrada en el panel de Spotify.
const PORT = 8888, ORIGIN = `http://127.0.0.1:${PORT}`;
// Lista blanca de recursos servidos (ruta -> [archivo, tipo MIME]). Cualquier otra ruta responde 404.
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/themes.js': ['themes.js', 'text/javascript; charset=utf-8'],
  '/settings.html': ['settings.html', 'text/html; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
  '/settings.css': ['settings.css', 'text/css; charset=utf-8'],
  '/inter.woff2': [path.join('node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'), 'font/woff2']
};
// Content-Security-Policy de la interfaz. connect-src e img-src admiten https genérico porque
// Spotify distribuye API, portadas y licencias DRM desde múltiples hosts; los scripts quedan
// restringidos al propio origen y al SDK oficial.
// CSP: scripts limited to same origin + the official SDK. Generic https in connect-src/img-src because Spotify
// serves its API, artwork and DRM licensing from many hosts.
const CSP = "default-src 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self'; img-src 'self' data: https:; " +
  "connect-src https: wss:; frame-src https://sdk.scdn.co; media-src https: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
// Ventana única de la aplicación.
const WIN = { width: 280, height: 484 };   // tamaño fijo de la ventana / fixed window size
let win;

// Instancia única: el puerto fijo impide ejecutar dos copias simultáneas.
// Single instance: the fixed port prevents two copies; a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});
// Se desactiva el manejo nativo de teclas multimedia de Chromium; de lo contrario cada
// pulsación se procesaría dos veces (nativo + globalShortcut).
// Native Chromium media-key handling is disabled; otherwise each key press would be processed twice.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

/**
 * Servidor HTTP local enlazado únicamente a loopback.
 * Sirve la interfaz y recibe el retorno del flujo OAuth (code/state/error), que reenvía
 * a la ventana por IPC. La validación del `state` (protección CSRF) la realiza el renderer.
 */
function serve() {
  return new Promise(ok => http.createServer((req, res) => {
    // Mitigates DNS rebinding: only the exact loopback Host header is served.
    if (req.headers.host !== `127.0.0.1:${PORT}`) { res.writeHead(403); return res.end(); } // Mitiga DNS rebinding: solo se atiende el Host exacto de loopback.
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/' && (u.searchParams.has('code') || u.searchParams.has('error'))) {
      win?.webContents.send('auth', { code: u.searchParams.get('code'), state: u.searchParams.get('state'), error: u.searchParams.get('error') });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><title>Listo</title><body style="font:16px sans-serif;background:#1b1535;color:#fff;display:grid;place-items:center;height:100vh;margin:0">Listo, ya podés volver al reproductor.');
    }
    const f = FILES[u.pathname];
    if (!f) { res.writeHead(404); return res.end(); }
    fs.readFile(path.join(__dirname, f[0]), (e, d) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': f[1], 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' });
      res.end(d);
    });
  }).on('error', () => {
    dialog.showErrorBox('Mini Player', `El puerto ${PORT} está ocupado por otro programa. Cerralo y volvé a abrir la app.`);
    app.quit();
  }).listen(PORT, '127.0.0.1', ok));
}

// Persistencia de sesión: el refresh token se cifra con safeStorage (DPAPI en Windows) y se
// almacena en userData, fuera del directorio del proyecto.
// Session persistence: the refresh token is encrypted with safeStorage (DPAPI on Windows) and stored in
// userData, outside the project tree.
const sf = () => path.join(app.getPath('userData'), 'session.bin');
ipcMain.handle('session:load', () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(sf()))); } catch { return null; } });
ipcMain.handle('session:save', (e, s) => {
  if (typeof s?.cid !== 'string' || typeof s?.rt !== 'string' || !safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(sf(), safeStorage.encryptString(JSON.stringify({ cid: s.cid, rt: s.rt, sc: String(s.sc || '') })));
});
ipcMain.handle('session:clear', () => fs.rmSync(sf(), { force: true }));
// Descarga de portadas en el proceso principal (solo desde el CDN de Spotify), entregadas como
// data URL: evita restricciones CORS al leer los píxeles en canvas para el color dominante.
// Artwork is fetched in the main process (Spotify CDN only) and returned as a data URL, avoiding CORS limits
// when sampling pixels for the dominant color.
ipcMain.handle('cover', async (e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://i.scdn.co/image/')) return null;
  try { const r = await fetch(url); return 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); } catch { return null; }
});
// Abre el login en el navegador del sistema; se valida el destino para no actuar como redirector abierto.
// Opens the OAuth login in the system browser; the destination is allow-listed to avoid acting as an open redirector.
ipcMain.on('login', (e, url) => { if (typeof url === 'string' && url.startsWith('https://accounts.spotify.com/authorize?')) shell.openExternal(url); });
// Estado "siempre encima": fuente única que mantiene sincronizados el botón de la interfaz y la bandeja.
let tray, menu;
function setPin(v) {
  win.setAlwaysOnTop(v, 'screen-saver');
  const item = menu?.getMenuItemById('pin'); if (item) item.checked = v;
  win.webContents.send('pinned', v);
}
ipcMain.handle('pin', () => { const v = !win.isAlwaysOnTop(); setPin(v); return v; });
ipcMain.on('now', (e, title, artist) => {
  if (typeof title === 'string' && typeof artist === 'string') tray?.setToolTip(`${artist} — ${title}`.slice(0, 120));
});
// Ícono de bandeja con menú contextual. Si falta el recurso gráfico, la aplicación continúa sin bandeja.
function setupTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (img.isEmpty()) return console.error('Falta icon.png: se omite la bandeja.');
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Mini Player');
  const toggle = () => { if (win.isVisible()) win.hide(); else { win.show(); win.focus(); } };
  tray.on('click', toggle);
  menu = Menu.buildFromTemplate([
    { label: 'Mostrar / Ocultar', click: toggle },
    { label: 'Ajustes…', click: openSettings },
    { id: 'pin', label: 'Siempre encima', type: 'checkbox', checked: false, click: m => setPin(m.checked) },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}
// Teclas multimedia globales (activas con la aplicación en segundo plano); se reenvían al renderer.
function registerMediaKeys() {
  const keys = { MediaPlayPause: 'toggle', MediaNextTrack: 'next', MediaPreviousTrack: 'prev' };
  for (const [k, cmd] of Object.entries(keys)) globalShortcut.register(k, () => win?.webContents.send('media', cmd));
}
app.on('will-quit', () => globalShortcut.unregisterAll());
ipcMain.on('close', () => app.quit());

// ---------- Ajustes de apariencia ----------
// Preferencias visuales en un JSON dentro de userData (sin datos sensibles). Toda entrada se valida contra
// una lista blanca antes de guardarse o difundirse.
// Appearance preferences: JSON file in userData (nothing sensitive). Every input is validated against an
// allow-list before being stored or broadcast.
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const oneOf = list => v => list.includes(v);
const RULES = {
  preset: oneOf(['classic', 'pure', 'light', 'neon', 'cherry', 'rainbow', 'custom']),
  bgMode: oneOf(['dynamic', 'fixed', 'gradient', 'blur', 'rainbow']),
  bgColor: isHex,
  accentMode: oneOf(['white', 'custom', 'auto']),
  accentColor: isHex,
  blossoms: v => typeof v === 'boolean'
};
const DEFAULTS = { preset: 'classic', bgMode: 'dynamic', bgColor: '#2a2060', accentMode: 'white', accentColor: '#ffffff', blossoms: false };
const sanitize = o => Object.fromEntries(Object.entries(RULES).filter(([k, ok]) => ok(o?.[k])).map(([k]) => [k, o[k]]));
const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS }, saveTimer;
try { settings = { ...DEFAULTS, ...sanitize(JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))) }; } catch { /* primer inicio / first run */ }

function applySettings(next) {
  settings = next;
  clearTimeout(saveTimer);   // escritura diferida: un selector de color emite decenas de cambios por segundo
  saveTimer = setTimeout(() => fs.writeFile(cfgFile(), JSON.stringify(settings), e => e && console.error('Ajustes:', e.message)), 300);
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings', settings);   // vista previa en vivo
  return settings;
}
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, partial) => applySettings({ ...settings, ...sanitize(partial) }));
ipcMain.handle('settings:reset', () => applySettings({ ...DEFAULTS }));

// Misma política de aislamiento para todas las ventanas. / Same isolation policy for every window.
const WEBPREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' };
let settingsWin;
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); return settingsWin.focus(); }
  settingsWin = new BrowserWindow({ width: 400, height: 600, title: 'Ajustes', resizable: false, minimizable: false, maximizable: false, webPreferences: WEBPREFS });
  settingsWin.setMenu(null);
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.webContents.on('will-navigate', e => e.preventDefault());
  settingsWin.loadURL(ORIGIN + '/settings.html');
}
ipcMain.on('open-settings', openSettings);
// Acciones del asistente de configuración. No reciben parámetros del renderer: no hay entrada que validar.
ipcMain.on('open-dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));
ipcMain.on('copy-redirect', () => clipboard.writeText(ORIGIN + '/'));
// Arrastre de ventana implementado manualmente: las regiones -webkit-app-region de Windows capturan
// los eventos de ratón y bloquean los controles superpuestos. Se usa setBounds con tamaño fijo para
// evitar derivas de tamaño con escalado de pantalla fraccionario.
// Manual window dragging: Windows -webkit-app-region zones swallow mouse events and break overlapping controls.
// Fixed-size setBounds avoids size drift under fractional DPI scaling.
let dragFrom;
ipcMain.on('drag-start', () => { const [x, y] = win.getPosition(); dragFrom = { x, y }; });
ipcMain.on('drag-move', (e, dx, dy) => {
  if (dragFrom && Number.isFinite(dx) && Number.isFinite(dy))
    win.setBounds({ x: Math.round(dragFrom.x + dx), y: Math.round(dragFrom.y + dy), ...WIN });
});

// Arranque: espera al CDM de Widevine, levanta el servidor local y crea la ventana.
app.whenReady().then(async () => {
  if (!gotLock) return;   // segunda instancia: no inicializar / second instance: skip initialization
  await components.whenReady();   // CDM de Widevine disponible antes de crear la ventana
  await serve();
  // Permisos de mínimo privilegio: solo se concede el acceso a DRM (EME).
  // Least-privilege permissions: only DRM (EME) access is granted.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'mediaKeySystem'));
  win = new BrowserWindow({
    ...WIN, frame: false, transparent: true, resizable: false, hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: WEBPREFS
  });
  // Se bloquean ventanas nuevas y la navegación fuera de la interfaz.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // El reproductor es la ventana principal: al cerrarlo se cierra todo, incluida la de ajustes.
  // The player is the main window: closing it quits the app, including the settings window.
  win.on('closed', () => app.quit());
  win.loadURL(ORIGIN + '/');
  try { setupTray(); } catch (e) { console.error('Bandeja:', e.message); }
  try { registerMediaKeys(); } catch (e) { console.error('Teclas multimedia:', e.message); }
});
// Red de seguridad: al salir se destruye la ventana de ajustes aunque siga abierta.
app.on('before-quit', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy(); });
app.on('window-all-closed', () => app.quit());
