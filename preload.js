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
  listen: () => ipcRenderer.send('pet:listen'),
  // 'arrived' | 'left' | 'blind'. Never a frame, never a measurement - the
  // renderer reduces what the camera saw to one of three words before this
  // bridge, and this is the only thing that crosses it.
  presence: (event) => ipcRenderer.send('pet:presence', String(event)),
  // The two exceptions to "never a frame", both off unless you switch them on.
  //
  // A photo you asked for by name: main asks, the renderer answers with exactly
  // one frame, and main writes it to disk.
  onPhoto: (fn) => ipcRenderer.on('pet:photo', () => fn()),
  photo: (dataUrl) => ipcRenderer.send('pet:photo-taken', dataUrl),
  // A face check, at the moment somebody arrives: one frame, handed to Windows'
  // own detector, which answers with a count and nothing else. Never written
  // anywhere - see faces.js.
  face: (dataUrl) => ipcRenderer.send('pet:face-check', dataUrl),
  // "Dance" was asked for: open the microphone for this many milliseconds and
  // move to whatever is playing. Nothing comes back the other way - the beat
  // never crosses this bridge, because nothing on the far side needs it.
  onDance: (fn) => ipcRenderer.on('pet:dance', (_e, ms) => fn(ms)),
  battery: (level) => ipcRenderer.send('pet:battery', level),
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
  // API keys go one way. `setKey` hands one to the main process, which wraps it
  // with DPAPI and writes it; `clearKey` removes it. Both answer with which
  // providers have a key, never with a key. There is deliberately no getKey.
  setKey: (provider, key) => ipcRenderer.invoke('keys:set', String(provider), String(key)),
  clearKey: (provider) => ipcRenderer.invoke('keys:clear', String(provider)),
});
