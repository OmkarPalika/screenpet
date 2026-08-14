'use strict';

const el = (id) => document.getElementById(id);
const modelSel = el('model');
const visionSel = el('vision');
const hotkeyInput = el('hotkey');
const skinsBox = el('skins');
const wearSel = el('wear');
const autostart = el('autostart');
const voice = el('voice');
const sounds = el('sounds');
const mic = el('mic');
const dictationSel = el('dictation');
const camera = el('camera');
const wakeBox = el('wake');
const bop = el('bop');
const faces = el('faces');
const network = el('network');
const weather = el('weather');
const city = el('city');
const web = el('web');
const providerSel = el('provider');
const providerModel = el('provider-model');
const apiKey = el('api-key');
const keyStatus = el('key-status');
const memoryBox = el('memory');
const cheek = el('cheek');
const status = el('status');
const saveBtn = el('save');

// Same shape check as settings.js. Duplicated deliberately: this one is only to
// disable the button early, the one in the main process is the real gate.
const ACCELERATOR = /^([A-Za-z0-9]+\+)*[A-Za-z0-9]+$/;

let current = null;
let skin = 'butter';
let species = 'blob';
let providerList = [];
// Which providers have a key stored. Booleans - the main process never hands
// one back, and there is no channel that could.
let keysPresent = {};

// The previews are drawn by the same stylesheet as the real pet, so they follow
// the selected skin live and can never disagree with what you actually get.
function fillPets(pets) {
  const box = el('pets');
  box.replaceChildren();
  for (const name of pets) {
    const b = document.createElement('button');
    b.className = 'pet-pick';
    b.dataset.pet = name;
    b.title = name;
    b.setAttribute('aria-pressed', String(name === species));
    b.append(el('pet-preview').content.cloneNode(true));
    const label = document.createElement('span');
    label.textContent = name;
    b.append(label);
    b.addEventListener('click', () => {
      species = name;
      for (const p of box.children) p.setAttribute('aria-pressed', String(p.dataset.pet === name));
    });
    box.append(b);
  }
}

function paintPreviews() {
  el('pets').dataset.skin = skin;
}

function fillModels(models, selected) {
  modelSel.replaceChildren();
  const names = models.length ? models : [selected];
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    modelSel.append(opt);
  }
  modelSel.value = selected;
  el('model-hint').textContent = models.length
    ? 'Used for reading text off the screen.'
    : 'Could not reach Ollama, so this list may be incomplete.';
  el('model-hint').classList.toggle('warn', !models.length);
}

function fillSkins(skins) {
  skinsBox.replaceChildren();
  for (const name of skins) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.skin = name;
    b.title = name;
    b.setAttribute('aria-pressed', String(name === skin));
    b.addEventListener('click', () => {
      skin = name;
      for (const s of skinsBox.children) {
        s.setAttribute('aria-pressed', String(s.dataset.skin === name));
      }
      paintPreviews();
    });
    skinsBox.append(b);
  }
}

// The names are the list from settings.js; only the wording is here, and an
// outfit with no wording falls back to its own name rather than to nothing.
const WEAR_LABELS = {
  none: 'Nothing',
  bow: 'Bow',
  shades: 'Shades',
  halo: 'Halo',
  hero: 'Masked hero — mask and cape',
  party: 'Party hat',
  wizard: 'Wizard hat',
  crown: 'Crown',
  headphones: 'Headphones',
};

function fillWear(list, selected) {
  wearSel.replaceChildren();
  for (const name of list) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = WEAR_LABELS[name] || name;
    wearSel.append(opt);
  }
  wearSel.value = selected;
}

function showVision(visionModel) {
  const hint = el('vision-hint');
  hint.textContent = visionModel
    ? `Windows OCR reads text; ${visionModel} steps in when there is none to read.`
    : 'No vision-capable model installed, so text is read with Windows OCR. '
      + 'Pull one (for example moondream) to handle diagrams.';
  hint.classList.toggle('warn', !visionModel);
}

// The main process refuses these combinations anyway; greying them out here is
// so the reason is visible before you save rather than after a checkbox quietly
// fails to stick.
function fillProviders(list, selected) {
  providerList = list;
  providerSel.replaceChildren();
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.label;
    providerSel.append(opt);
  }
  providerSel.value = selected;
}

const chosenProvider = () => providerList.find((p) => p.name === providerSel.value) || null;

// What the provider choice actually means, said before you save rather than
// after. The wording is blunt on purpose - this is the setting that changes
// where the text read off your screen ends up.
function showProvider() {
  const p = chosenProvider();
  const hint = el('provider-hint');
  const local = !p || p.local;
  hint.classList.toggle('warn', !local);
  hint.textContent = local
    ? 'Ollama, on this machine. Nothing about your screen leaves.'
    : `The text read off your screen is sent to ${p.label}. It is redacted for keys,`
      + ' tokens and card numbers first, but everything else on the screen goes as it'
      + ` is. Diagrams stop working — a screenshot cannot be redacted, so it is never`
      + ` uploaded.${p.keys ? ` Keys come from ${p.keys}.` : ''}`;

  providerModel.placeholder = p && p.model ? p.model : '';
  providerModel.disabled = local;
  apiKey.disabled = local;
  el('key-save').disabled = local;
  el('key-clear').disabled = local || !keysPresent[providerSel.value];
  keyStatus.textContent = local ? ''
    : keysPresent[providerSel.value] ? 'A key is stored.' : 'No key stored yet.';
}

function gateDevices() {
  for (const [box, need] of [
    [wakeBox, mic], [bop, mic], [faces, camera], [cheek, memoryBox],
    [weather, network], [web, network],
  ]) {
    box.disabled = !need.checked;
    if (!need.checked) box.checked = false;
  }
  city.disabled = !weather.checked;
  // Which recogniser is a choice about a microphone that is switched off, so it
  // greys out with the rest of them - but it keeps its value rather than being
  // reset, because it is a preference and not a permission.
  dictationSel.disabled = !mic.checked;
  // A hosted provider is one of the things the master switch gates, so turning
  // the network off has to put the choice back to the local model here too -
  // otherwise the select shows something the main process has already refused.
  providerSel.disabled = !network.checked;
  if (!network.checked) providerSel.value = 'ollama';
  showProvider();
}

function validate() {
  const ok = ACCELERATOR.test(hotkeyInput.value.trim());
  hotkeyInput.classList.toggle('bad', !ok);
  saveBtn.disabled = !ok;
  return ok;
}

hotkeyInput.addEventListener('input', () => {
  validate();
  status.textContent = '';
});

for (const box of [mic, camera, weather, memoryBox, network]) {
  box.addEventListener('change', gateDevices);
}
providerSel.addEventListener('change', showProvider);

// The key never round-trips: it is handed over, and the box is emptied whatever
// happened next. What comes back is which providers have one.
el('key-save').addEventListener('click', async () => {
  const value = apiKey.value.trim();
  if (!value) return;
  keyStatus.textContent = 'Storing…';
  const res = await window.config.setKey(providerSel.value, value);
  apiKey.value = '';
  if (res.ok) keysPresent = res.keys;
  showProvider();
  if (!res.ok) keyStatus.textContent = res.why;
});

el('key-clear').addEventListener('click', async () => {
  const res = await window.config.clearKey(providerSel.value);
  keysPresent = res.keys;
  apiKey.value = '';
  showProvider();
  keyStatus.textContent = 'Key forgotten.';
});

saveBtn.addEventListener('click', async () => {
  if (!validate()) return;
  status.textContent = 'Saving…';
  const res = await window.config.save({
    model: modelSel.value,
    vision: visionSel.value,
    hotkey: hotkeyInput.value.trim(),
    pet: species,
    skin,
    wear: wearSel.value,
    voice: voice.checked,
    sounds: sounds.checked,
    mic: mic.checked,
    dictation: dictationSel.value,
    camera: camera.checked,
    wake: wakeBox.checked,
    bop: bop.checked,
    faces: faces.checked,
    network: network.checked,
    weather: weather.checked,
    city: city.value.trim(),
    web: web.checked,
    provider: providerSel.value,
    providerModel: providerModel.value.trim(),
    memory: memoryBox.checked,
    cheek: cheek.checked,
    autostart: autostart.checked,
  });
  current = res.settings;
  showVision(res.visionModel);
  // Reflect what was actually accepted - a rejected value silently reverting
  // would be worse than showing the user it did not stick.
  hotkeyInput.value = current.hotkey;
  voice.checked = current.voice;
  sounds.checked = current.sounds;
  wearSel.value = current.wear;
  camera.checked = current.camera;
  mic.checked = current.mic;
  dictationSel.value = current.dictation;
  wakeBox.checked = current.wake;
  bop.checked = current.bop;
  faces.checked = current.faces;
  weather.checked = current.weather;
  city.value = current.city;
  network.checked = current.network;
  web.checked = current.web;
  providerSel.value = current.provider;
  providerModel.value = current.providerModel;
  memoryBox.checked = current.memory;
  cheek.checked = current.cheek;
  gateDevices();
  status.textContent = 'Saved.';
});

el('close').addEventListener('click', () => window.config.close());

(async () => {
  const data = await window.config.get();
  current = data.settings;
  skin = current.skin;
  species = current.pet;

  keysPresent = data.keys || {};
  fillProviders(data.providers || [{ name: 'ollama', label: 'Ollama — on this machine', local: true }],
    current.provider);
  fillModels(data.models, current.model);
  fillPets(data.pets);
  fillSkins(data.skins);
  fillWear(data.wear || ['none'], current.wear);
  paintPreviews();
  showVision(data.visionModel);

  // 'auto' and 'off' are the two built-in options; an explicit model name that
  // is not one of them needs an option of its own or the select shows nothing.
  if (current.vision !== 'auto' && current.vision !== 'off') {
    const opt = document.createElement('option');
    opt.value = current.vision;
    opt.textContent = `Always use ${current.vision}`;
    visionSel.append(opt);
  }
  visionSel.value = current.vision;

  hotkeyInput.value = current.hotkey;
  voice.checked = current.voice;
  sounds.checked = current.sounds;
  wearSel.value = current.wear;
  camera.checked = current.camera;
  mic.checked = current.mic;
  dictationSel.value = current.dictation;
  wakeBox.checked = current.wake;
  bop.checked = current.bop;
  faces.checked = current.faces;
  weather.checked = current.weather;
  city.value = current.city;
  network.checked = current.network;
  web.checked = current.web;
  providerSel.value = current.provider;
  providerModel.value = current.providerModel;
  memoryBox.checked = current.memory;
  cheek.checked = current.cheek;
  gateDevices();
  autostart.checked = current.autostart;
  autostart.disabled = !data.packaged;
  el('autostart-hint').textContent = data.packaged
    ? ''
    : 'Only available in the packaged app - in development this would launch Electron itself.';

  validate();
})();
