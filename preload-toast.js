/**
 * Preload de la ventanita de aviso (contexto aislado, sandbox).
 * Superficie mínima: solo recibe los datos del aviso; no puede enviar nada al proceso principal.
 */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('toast', { onShow: cb => ipcRenderer.on('toast', (_, d) => cb(d)) });
