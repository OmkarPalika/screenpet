'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Deliberately narrow: the renderer can report hover, request an action, and
// listen. It gets no filesystem, no shell, no arbitrary IPC.
contextBridge.exposeInMainWorld('pet', {
  onSay: (fn) => ipcRenderer.on('pet:say', (_e, payload) => fn(payload)),
  onStats: (fn) => ipcRenderer.on('pet:stats', (_e, payload) => fn(payload)),
  onLook: (fn) => ipcRenderer.on('pet:look', (_e, look) => fn(look)),
  act: (name) => ipcRenderer.send('pet:act', name),
  react: (event) => ipcRenderer.send('pet:react', String(event)),
  chat: (text) => ipcRenderer.send('pet:chat', String(text)),
  chatOpen: (open) => ipcRenderer.send('pet:chat-open', !!open),
  ask: () => ipcRenderer.send('pet:ask'),
  settings: () => ipcRenderer.send('pet:settings'),
  setInteractive: (v) => ipcRenderer.send('pet:interactive', !!v),
  quit: () => ipcRenderer.send('pet:quit'),
});

contextBridge.exposeInMainWorld('config', {
  get: () => ipcRenderer.invoke('config:get'),
  save: (patch) => ipcRenderer.invoke('config:save', patch),
  close: () => ipcRenderer.send('config:close'),
});
