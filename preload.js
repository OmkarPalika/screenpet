'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onState: (fn) => ipcRenderer.on('pet:state', (_e, state) => fn(state)),
});
