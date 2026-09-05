'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Deliberately narrow: the renderer can report hover, request an action, and
// listen. It gets no filesystem, no shell, no arbitrary IPC.
contextBridge.exposeInMainWorld('pet', {
  onSay: (fn) => ipcRenderer.on('pet:say', (_e, payload) => fn(payload)),
  onStats: (fn) => ipcRenderer.on('pet:stats', (_e, payload) => fn(payload)),
  onLook: (fn) => ipcRenderer.on('pet:look', (_e, look) => fn(look)),
  onGlance: (fn) => ipcRenderer.on('pet:glance', (_e, at) => fn(at)),
  act: (name) => ipcRenderer.send('pet:act', name),
  react: (event) => ipcRenderer.send('pet:react', String(event)),
  // Where you put it, as two fractions. Validated again in the main process:
  // the renderer is the thing that knows where the pet is, not the thing that
  // gets to decide what a legal position is.
  place: ({ x, y }) => ipcRenderer.send('pet:place', { x: Number(x), y: Number(y) }),
  chat: (text) => ipcRenderer.send('pet:chat', String(text)),
  // A line of speech as audio, so the renderer can put it through the filter
  // chain in robot.js. Resolves to null whenever that is not available, and the
  // renderer speaks the line with the platform voice instead.
  voice: (text) => ipcRenderer.invoke('pet:voice', String(text)),
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
  // The mouth stopped moving. Nothing else - not what was said, not how long
  // it took. A conversation needs to know when it is its turn again, and this
  // is the whole of what that takes.
  spoke: () => ipcRenderer.send('pet:spoke'),
  // You were singing. Nothing about what was sung crosses this - not the words,
  // not the tune, not a measurement of either. The renderer decides out of the
  // same spectrum it is already watching for the beat, and what arrives here is
  // that it happened. See singing.js.
  sang: () => ipcRenderer.send('pet:sang'),
  // "Dance" was asked for: open the microphone for this many milliseconds and
  // move to whatever is playing. Nothing comes back the other way - the beat
  // never crosses this bridge, because nothing on the far side needs it.
  onDance: (fn) => ipcRenderer.on('pet:dance', (_e, ms) => fn(ms)),
  // Dictation, when the recogniser is whisper rather than Windows' own. Windows
  // opens the microphone itself inside PowerShell and nothing crosses here;
  // whisper needs the audio, so main asks for one phrase and the renderer
  // answers with one WAV. It is never sent unasked, main drops it if it was, and
  // it is not written anywhere on either side of this line.
  onRecord: (fn) => ipcRenderer.on('pet:record', () => fn()),
  audio: (buf) => ipcRenderer.send('pet:audio', buf),
  battery: (level) => ipcRenderer.send('pet:battery', level),
  // Breaks. The pet has a thought about water or about sitting still; you click
  // it, or you do not. Four messages, none of which carry anything about the
  // machine: think about this, I clicked it, here is how long, it is over.
  onThink: (fn) => ipcRenderer.on('pet:think', (_e, what) => fn(what)),
  breakTake: () => ipcRenderer.send('break:take'),
  onBreak: (fn) => ipcRenderer.on('break:show', (_e, b) => fn(b)),
  breakDone: () => ipcRenderer.send('break:done'),
  chatOpen: (open) => ipcRenderer.send('pet:chat-open', !!open),
  ask: () => ipcRenderer.send('pet:ask'),
  settings: () => ipcRenderer.send('pet:settings'),
  setInteractive: (v) => ipcRenderer.send('pet:interactive', !!v),
  quit: () => ipcRenderer.send('pet:quit'),
  // Coming out of the house on launch, and going back into it on quit. The
  // main process asks for the walk and, on the way out, waits; left() is the
  // renderer saying the door is shut, which is what ends that wait early.
  onEnter: (fn) => ipcRenderer.on('pet:enter', () => fn()),
  onLeave: (fn) => ipcRenderer.on('pet:leave', () => fn()),
  left: () => ipcRenderer.send('pet:left'),
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
  // Updates. Three one-way calls, all started by a button: ask what is out,
  // fetch and install it, and hear how far the download got. Nothing about this
  // machine goes the other way - see system/update.js.
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: (fn) => ipcRenderer.on('update:progress', (_e, percent) => fn(Number(percent))),
  },
});
