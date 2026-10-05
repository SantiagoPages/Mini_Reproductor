/**
 * Preload (contexto aislado, sandbox).
 * Define la superficie de API disponible para la interfaz: cada método se mapea a un canal IPC
 * concreto. No se expone `ipcRenderer` ni `require`.
 */
const { contextBridge, ipcRenderer } = require('electron');
// API expuesta a la interfaz como `window.bridge`.
// API surface exposed to the UI as window.bridge: each method maps to one IPC channel; neither ipcRenderer nor require is exposed.
contextBridge.exposeInMainWorld('bridge', {
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: s => ipcRenderer.invoke('session:save', s),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  cover: url => ipcRenderer.invoke('cover', url),
  openLogin: url => ipcRenderer.send('login', url),
  onAuth: cb => ipcRenderer.on('auth', (_, d) => cb(d)),
  togglePin: () => ipcRenderer.invoke('pin'),
  close: () => ipcRenderer.send('close'),
  nowPlaying: (t, a) => ipcRenderer.send('now', t, a),
  onMedia: cb => ipcRenderer.on('media', (_, c) => cb(c)),
  onPinned: cb => ipcRenderer.on('pinned', (_, v) => cb(v)),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  copyRedirect: () => ipcRenderer.send('copy-redirect'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy)
});
