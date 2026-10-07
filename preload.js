/**
 * Preload (contexto aislado, sandbox).
 * Define la superficie de API disponible para la interfaz: cada método se mapea a un canal IPC
 * concreto. No se expone `ipcRenderer` ni `require`.
 */
const { contextBridge, ipcRenderer } = require('electron');
// API expuesta a la interfaz como `window.bridge`: cada método corresponde a un único canal IPC; no se expone
// `ipcRenderer` ni `require`.
contextBridge.exposeInMainWorld('bridge', {
  // Sesión (el refresh token se guarda cifrado en el proceso principal).
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: s => ipcRenderer.invoke('session:save', s),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  // Portadas, inicio de sesión y retorno de OAuth.
  cover: url => ipcRenderer.invoke('cover', url),
  openLogin: url => ipcRenderer.send('login', url),
  onAuth: cb => ipcRenderer.on('auth', (_, d) => cb(d)),
  // Ventana: siempre encima y cerrar.
  togglePin: () => ipcRenderer.invoke('pin'),
  close: () => ipcRenderer.send('close'),
  // Ajustes de apariencia: lectura, cambios parciales (validados en main), restablecer y difusión en vivo.
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: p => ipcRenderer.invoke('settings:set', p),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: cb => ipcRenderer.on('settings', (_, s) => cb(s)),
  openSettings: () => ipcRenderer.send('open-settings'),
  // Reproducción: pista actual para la bandeja y teclas multimedia globales.
  nowPlaying: (t, a) => ipcRenderer.send('now', t, a),
  onMedia: cb => ipcRenderer.on('media', (_, c) => cb(c)),
  onPinned: cb => ipcRenderer.on('pinned', (_, v) => cb(v)),
  // Asistente de configuración: abrir el panel de Spotify y copiar la redirect URI.
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  copyRedirect: () => ipcRenderer.send('copy-redirect'),
  // Aviso de versión nueva: consulta y apertura de la página de la release (sin parámetros desde la interfaz).
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdate: () => ipcRenderer.send('open-update'),
  // Temas secretos: lista de desbloqueados, intento de desbloqueo con un código y aviso de cambios.
  secretList: () => ipcRenderer.invoke('secret:list'),
  secretUnlock: c => ipcRenderer.invoke('secret:unlock', c),
  onSecrets: cb => ipcRenderer.on('secrets', (_, p) => cb(p)),
  // Alto de diseño informado por la interfaz y arrastre manual de la ventana.
  setLayoutHeight: h => ipcRenderer.send('layout-height', h),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy)
});
