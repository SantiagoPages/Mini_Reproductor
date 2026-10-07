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
const { app, BrowserWindow, components, ipcMain, safeStorage, shell, session, dialog, clipboard, Tray, Menu, nativeImage, globalShortcut, screen } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
const secretos = require('./secretos');
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
  '/inter.woff2': [path.join('node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'), 'font/woff2'],
  // Tipografías opcionales (licencia OFL). Se cargan solo si el usuario las elige.
  '/nunito.woff2': [path.join('node_modules', '@fontsource-variable', 'nunito', 'files', 'nunito-latin-wght-normal.woff2'), 'font/woff2'],
  '/outfit.woff2': [path.join('node_modules', '@fontsource-variable', 'outfit', 'files', 'outfit-latin-wght-normal.woff2'), 'font/woff2'],
  '/atkinson-400.woff2': [path.join('node_modules', '@fontsource', 'atkinson-hyperlegible', 'files', 'atkinson-hyperlegible-latin-400-normal.woff2'), 'font/woff2'],
  '/atkinson-700.woff2': [path.join('node_modules', '@fontsource', 'atkinson-hyperlegible', 'files', 'atkinson-hyperlegible-latin-700-normal.woff2'), 'font/woff2'],
  '/mono.woff2': [path.join('node_modules', '@fontsource', 'share-tech-mono', 'files', 'share-tech-mono-latin-400-normal.woff2'), 'font/woff2']
};
// Content-Security-Policy de la interfaz. connect-src e img-src admiten https genérico porque
// Spotify distribuye API, portadas y licencias DRM desde múltiples hosts; los scripts quedan
// restringidos al propio origen y al SDK oficial.
const CSP = "default-src 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self'; img-src 'self' data: https:; " +
  "connect-src https: wss:; frame-src https://sdk.scdn.co; media-src https: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
// Ventana única de la aplicación.
// Tamaño base de la interfaz (px CSS). La ventana mide BASE x escala; WIN es el tamaño vigente.
// El alto base (BASE.height) lo informa la interfaz según los elementos visibles (ver 'layout-height').
const BASE = { width: 280, height: 484 };
const WIN = { ...BASE };
const sizeFor = s => ({ width: Math.round(BASE.width * s), height: Math.round(BASE.height * s) });
// La escala nunca supera lo que entra en el área útil del monitor (sin barra de tareas).
const fitScale = (s, area) => Math.max(.5, Math.min(s, (area.height - 16) / BASE.height, (area.width - 16) / BASE.width));
let win;

// Instancia única: el puerto fijo impide ejecutar dos copias simultáneas.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});
// Se desactiva el manejo nativo de teclas multimedia de Chromium; de lo contrario cada
// pulsación se procesaría dos veces (nativo + globalShortcut).
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

/**
 * Servidor HTTP local enlazado únicamente a loopback.
 * Sirve la interfaz y recibe el retorno del flujo OAuth (code/state/error), que reenvía
 * a la ventana por IPC. La validación del `state` (protección CSRF) la realiza el renderer.
 */
function serve() {
  return new Promise(ok => http.createServer((req, res) => {
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
const sf = () => path.join(app.getPath('userData'), 'session.bin');
ipcMain.handle('session:load', () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(sf()))); } catch { return null; } });
ipcMain.handle('session:save', (e, s) => {
  if (typeof s?.cid !== 'string' || typeof s?.rt !== 'string' || !safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(sf(), safeStorage.encryptString(JSON.stringify({ cid: s.cid, rt: s.rt, sc: String(s.sc || '') })));
});
ipcMain.handle('session:clear', () => fs.rmSync(sf(), { force: true }));
// Descarga de portadas en el proceso principal (solo desde el CDN de Spotify), entregadas como
// data URL: evita restricciones CORS al leer los píxeles en canvas para el color dominante.
ipcMain.handle('cover', async (e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://i.scdn.co/image/')) return null;
  try { const r = await fetch(url); return 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); } catch { return null; }
});
// Abre el login en el navegador del sistema; se valida el destino para no actuar como redirector abierto.
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
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (lo, hi) => v => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const oneOf = list => v => list.includes(v);
const bool = v => typeof v === 'boolean';
const RULES = {
  // Además de los temas públicos, se admiten temas secretos desbloqueados (id "s_xxxx").
  preset: v => ['classic', 'pure', 'light', 'neon', 'cherry', 'rainbow', 'custom'].includes(v) || (typeof v === 'string' && /^s_[a-z0-9]{1,16}$/.test(v)),
  bgMode: oneOf(['dynamic', 'fixed', 'gradient', 'blur', 'rainbow']),
  bgColor: isHex,
  accentMode: oneOf(['white', 'custom', 'auto']),
  accentColor: isHex,
  blossoms: v => typeof v === 'boolean',
  scale: num(.7, 1.6),
  radius: num(0, 40),
  bgOpacity: num(.25, 1),
  // Etapa 2: qué se muestra, tipografía, estilo de botones y forma de la portada.
  showCover: bool, showArtist: bool, showLike: bool, showShuffle: bool, showRepeat: bool, showDevices: bool, updateCheck: bool, sfx: bool, showTime: bool, showVolume: bool,
  font: oneOf(['inter', 'nunito', 'mono', 'outfit', 'dyslexic']),
  btnStyle: oneOf(['raised', 'flat', 'outline', 'icon', 'wheel']),
  coverShape: oneOf(['rounded', 'square', 'circle']),
  layoutH: num(120, 800)   // último alto de diseño informado por la interfaz (evita parpadeo al iniciar)
};
const DEFAULTS = { preset: 'classic', bgMode: 'dynamic', bgColor: '#2a2060', accentMode: 'white', accentColor: '#ffffff', blossoms: false, scale: 1, radius: 28, bgOpacity: 1,
  showCover: true, showArtist: true, showLike: true, showShuffle: true, showRepeat: true, showDevices: true, updateCheck: true, sfx: true, showTime: true, showVolume: true,
  font: 'inter', btnStyle: 'raised', coverShape: 'rounded', layoutH: 484 };
const sanitize = o => Object.fromEntries(Object.entries(RULES).filter(([k, ok]) => ok(o?.[k])).map(([k]) => [k, o[k]]));
const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS }, saveTimer;
try { settings = { ...DEFAULTS, ...sanitize(JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))) }; } catch { /* primer inicio */ }
BASE.height = settings.layoutH;
// Escritura diferida: un selector de color emite decenas de cambios por segundo.
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(cfgFile(), JSON.stringify(settings), e => e && console.error('Ajustes:', e.message)), 300); };

function applySettings(next) {
  const resized = next.scale !== settings.scale;
  settings = next;
  persist();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings', settings);   // vista previa en vivo
  if (resized) applyScale();
  return settings;
}

/**
 * Redimensiona la ventana manteniendo su centro y dentro del monitor. La interfaz se escala sola al leer
 * el nuevo ancho (ver fitScale en app.js).
 */
function applyScale(keepTop = false) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds(), area = screen.getDisplayMatching(b).workArea;
  const size = sizeFor(fitScale(settings.scale, area));
  Object.assign(WIN, size);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const x = clamp(Math.round(b.x + b.width / 2 - size.width / 2), area.x, area.x + area.width - size.width);
  // keepTop: un cambio de alto (p. ej. ocultar la portada) conserva el borde superior de la ventana.
  const y = clamp(keepTop ? b.y : Math.round(b.y + b.height / 2 - size.height / 2), area.y, area.y + area.height - size.height);
  win.setResizable(true); win.setBounds({ x: keepTop ? clamp(b.x, area.x, area.x + area.width - size.width) : x, y, ...size }); win.setResizable(false);   // setBounds exige resizable en Windows
}
// La interfaz informa su alto natural (px CSS sin escala) cuando cambian los elementos visibles.
ipcMain.on('layout-height', (e, h) => {
  if (e.sender !== win?.webContents || !num(120, 800)(h)) return;
  h = Math.round(h); if (h === BASE.height) return;
  BASE.height = h; settings = { ...settings, layoutH: h }; persist(); applyScale(true);
});
// ---------- Aviso de actualizaciones ----------
// Consulta la última release publicada en GitHub (solo lectura, sin credenciales) y avisa si es más nueva.
// No descarga ni instala nada: el botón abre la página de la release en el navegador. El renderer no envía
// parámetros, por lo que no puede forzar una URL arbitraria.
const REPO = 'SantiagoPages/Mini_Reproductor';
const ver3 = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = ver3(a), y = ver3(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
ipcMain.handle('update:check', async () => {
  if (!settings.updateCheck) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mini-player' } });
    if (!r.ok) return null;
    const tag = (await r.json()).tag_name;
    return typeof tag === 'string' && /^v?\d+(\.\d+){1,2}$/.test(tag) && isNewer(tag, app.getVersion()) ? { version: tag.replace(/^v/i, '') } : null;
  } catch { return null; }
});
ipcMain.on('open-update', () => shell.openExternal(`https://github.com/${REPO}/releases/latest`));
// ---------- Temas secretos ----------
// Los paquetes cifrados (carpeta secretos/) se prueban contra el código ingresado. Los que descifran se validan
// contra un esquema estricto (solo datos: colores, SVG, sonido) y se guardan cifrados con safeStorage; el código
// no se guarda. Tras 5 fallos se bloquean los intentos 30 s.
const SECRET_KEYS = ['bgMode', 'bgColor', 'accentMode', 'accentColor', 'radius', 'bgOpacity', 'font', 'btnStyle', 'coverShape'];
const str = (v, n) => typeof v === 'string' && v.length <= n;
function cleanPack(o) {
  if (!o || typeof o !== 'object' || !/^s_[a-z0-9]{1,16}$/.test(o.id) || !str(o.label, 24) || !str(o.swatch, 200) || !/^[#a-z0-9(),.% -]+$/i.test(o.swatch)) return null;
  const settings = Object.fromEntries(Object.entries(sanitize(o.settings)).filter(([k]) => SECRET_KEYS.includes(k)));
  const decor = (Array.isArray(o.decor) ? o.decor : []).slice(0, 4).filter(d => d && ['top', 'bottom'].includes(d.at) && str(d.svg, 20000)).map(d => ({ at: d.at, svg: d.svg }));
  const f = o.fall, fall = f && str(f.svg, 4000) && Number.isInteger(f.count) && f.count >= 1 && f.count <= 24 ? { svg: f.svg, count: f.count } : null;
  // Imagen de fondo (data URI) con atenuación opcional, y sonido (mp3 en base64).
  const image = str(o.image, 600000) && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.image) ? o.image : null;
  const imageDim = num(0, .85)(o.imageDim) ? o.imageDim : 0;
  const data = str(o.sound?.data, 300000) && /^[A-Za-z0-9+/=]+$/.test(o.sound.data) ? o.sound.data : null;
  const sound = data ? { type: 'sample', volume: num(0, 1)(o.sound.volume) ? o.sound.volume : .5, data } : null;
  const pad = num(0, 100)(o.pad) ? o.pad : 0;   // espacio extra abajo para que la decoración no tape los controles
  return { id: o.id, label: o.label, swatch: o.swatch, settings, decor, fall, image, imageDim, pad, sound };
}
const packFile = () => path.join(app.getPath('userData'), 'secretos.bin');
let packs = [], fails = 0, lockUntil = 0;
function loadPacks() {
  try { packs = JSON.parse(safeStorage.decryptString(fs.readFileSync(packFile()))).map(cleanPack).filter(Boolean); } catch { packs = []; }
}
function savePacks() {
  try { if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(packFile(), safeStorage.encryptString(JSON.stringify(packs))); } catch (e) { console.error('Secretos:', e.message); }
}
ipcMain.handle('secret:list', () => packs);
ipcMain.handle('secret:unlock', async (e, code) => {
  if (!str(code, 200) || code.trim().length < 3) return { ok: false };
  if (Date.now() < lockUntil) return { ok: false, wait: true };
  let found = null, files = [];
  try { files = fs.readdirSync(path.join(__dirname, 'secretos')).filter(f => f.endsWith('.bin')); } catch { /* sin paquetes */ }
  for (const f of files) {
    try { found = cleanPack(await secretos.open(fs.readFileSync(path.join(__dirname, 'secretos', f)), code)); } catch { found = null; }
    if (found) break;
  }
  if (!found) { if (++fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; } return { ok: false }; }
  fails = 0; packs = [...packs.filter(p => p.id !== found.id), found]; savePacks();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('secrets', packs);
  return { ok: true, label: found.label };
});
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, partial) => applySettings({ ...settings, ...sanitize(partial) }));
ipcMain.handle('settings:reset', () => applySettings({ ...DEFAULTS, layoutH: settings.layoutH }));

// Misma política de aislamiento para todas las ventanas.
const WEBPREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' };
let settingsWin;
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); return settingsWin.focus(); }
  settingsWin = new BrowserWindow({ width: 400, height: 780, title: 'Ajustes', resizable: false, minimizable: false, maximizable: false, webPreferences: WEBPREFS });
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
let dragFrom;
ipcMain.on('drag-start', () => { const [x, y] = win.getPosition(); dragFrom = { x, y }; });
ipcMain.on('drag-move', (e, dx, dy) => {
  if (dragFrom && Number.isFinite(dx) && Number.isFinite(dy))
    win.setBounds({ x: Math.round(dragFrom.x + dx), y: Math.round(dragFrom.y + dy), ...WIN });
});

// Arranque: espera al CDM de Widevine, levanta el servidor local y crea la ventana.
app.whenReady().then(async () => {
  if (!gotLock) return;   // segunda instancia: no inicializar
  loadPacks();
  await components.whenReady();   // CDM de Widevine disponible antes de crear la ventana
  await serve();
  // Permisos de mínimo privilegio: solo se concede el acceso a DRM (EME).
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'mediaKeySystem'));
  Object.assign(WIN, sizeFor(fitScale(settings.scale, screen.getPrimaryDisplay().workArea)));
  win = new BrowserWindow({
    ...WIN, frame: false, transparent: true, resizable: false, hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: WEBPREFS
  });
  // Se bloquean ventanas nuevas y la navegación fuera de la interfaz.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // El reproductor es la ventana principal: al cerrarlo se cierra todo, incluida la de ajustes.
  win.on('closed', () => app.quit());
  win.loadURL(ORIGIN + '/');
  try { setupTray(); } catch (e) { console.error('Bandeja:', e.message); }
  try { registerMediaKeys(); } catch (e) { console.error('Teclas multimedia:', e.message); }
});
// Red de seguridad: al salir se destruye la ventana de ajustes aunque siga abierta.
app.on('before-quit', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy(); });
app.on('window-all-closed', () => app.quit());
