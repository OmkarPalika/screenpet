'use strict';

const el = (id) => document.getElementById(id);
const modelSel = el('model');
const visionSel = el('vision');
const hotkeyInput = el('hotkey');
const nameInput = el('pet-name');
const skinsBox = el('skins');
const wearSel = el('wear');
const autostart = el('autostart');
const voice = el('voice');
const voiceHint = el('voice-hint');
const sounds = el('sounds');
const focus = el('focus');
const watchBox = el('watch');
const watchEvery = el('watch-every');
const breaksBox = el('breaks');
const breakEvery = el('break-every');
const breakFor = el('break-for');
const mischief = el('mischief');
const mic = el('mic');
const dictationSel = el('dictation');
const camera = el('camera');
const wakeBox = el('wake');
const bop = el('bop');
const converse = el('converse');
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
const updateCheck = el('update-check');
const updateInstall = el('update-install');
const updateStatus = el('update-status');

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

function fillModels(models, selected, brain, advice) {
  modelSel.replaceChildren();
  const names = models.length ? models : [selected];
  const pick = advice && advice.text ? advice.text.name : null;
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    // Marked in the list as well as explained under it. A recommendation you
    // have to read a paragraph to act on is one you scroll past, and the whole
    // problem this solves is nine names that all look equally plausible.
    opt.textContent = name === pick ? `${name} — suggested` : name;
    modelSel.append(opt);
  }
  modelSel.value = selected;
  // Not styled as a warning when there is nothing installed. Nothing is broken:
  // the pet works without a model, and reading the screen is the part this
  // switches on. Calling that an error is what makes people uninstall the app
  // rather than install Ollama.
  el('model-hint').textContent = models.length
    ? modelAdvice(advice, selected)
    : brain
      ? 'Could not list what is installed, so this may be incomplete.'
      : 'Nothing installed yet, so the pet cannot read your screen — everything else '
        + 'it does works without a model. Install Ollama, pull this one, and reading '
        + 'switches itself on.';
  el('model-hint').classList.remove('warn');
  clampHint(el('model-hint'));
}

/**
 * What to say under the model list.
 *
 * Says nothing about the choice when the chosen one is already the suggestion -
 * a panel that congratulates you on a setting you did not change is noise, and
 * this window has enough to read.
 */
function modelAdvice(advice, selected) {
  const said = ['Used for reading text off the screen.'];
  const pick = advice && advice.text;
  if (pick && pick.name !== selected) {
    said.push(`${pick.name} would suit the pet better: ${pick.why}.`);
  }
  if (advice && advice.vision) {
    said.push(`Diagrams go to ${advice.vision.name}.`);
  }
  for (const note of (advice && advice.notes) || []) said.push(note);
  return said.join(' ');
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
  clampHint(hint);
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

  // Reading the screen on a timer is local-only. The main process enforces it;
  // this is so the reason is visible before you save rather than after the
  // checkbox quietly fails to stick.
  watchBox.disabled = !local;
  watchEvery.disabled = !local;
  if (!local) watchBox.checked = false;
  const watchLabel = watchBox.closest('label');
  if (watchLabel) watchLabel.classList.toggle('unavailable', !local);

  clampHint(hint);

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
    [wakeBox, mic], [bop, mic], [converse, mic], [faces, camera], [cheek, memoryBox],
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
    name: nameInput.value.trim(),
    pet: species,
    skin,
    wear: wearSel.value,
    voice: voice.checked,
    sounds: sounds.checked,
    focus: focus.checked,
    watch: watchBox.checked,
    watchEvery: Number(watchEvery.value),
    breaks: breaksBox.checked,
    breakEvery: Number(breakEvery.value),
    breakFor: Number(breakFor.value),
    mischief: mischief.checked,
    mic: mic.checked,
    dictation: dictationSel.value,
    camera: camera.checked,
    wake: wakeBox.checked,
    bop: bop.checked,
    converse: converse.checked,
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
  // Shows what was accepted, not what was typed: a name that was all emoji
  // comes back empty, which is the honest answer.
  nameInput.value = current.name;
  voice.checked = current.voice;
  sounds.checked = current.sounds;
  focus.checked = current.focus;
  // Refused rather than clamped when a hosted provider is chosen, so what comes
  // back is what the app is actually going to do.
  watchBox.checked = current.watch;
  watchEvery.value = current.watchEvery;
  breaksBox.checked = current.breaks;
  // Clamped rather than rejected in settings.js, so what comes back is what the
  // app is actually going to do - typing 2 minutes and being shown 5 is the
  // point of putting it back in the box.
  breakEvery.value = current.breakEvery;
  breakFor.value = current.breakFor;
  mischief.checked = current.mischief;
  wearSel.value = current.wear;
  camera.checked = current.camera;
  mic.checked = current.mic;
  dictationSel.value = current.dictation;
  wakeBox.checked = current.wake;
  bop.checked = current.bop;
  converse.checked = current.converse;
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

/**
 * Which voice you are actually hearing.
 *
 * Named rather than described, because the two sound nothing like each other
 * and "a voice installed on Windows" tells you neither which one you have nor
 * that there is a better one to be had. The instructions are only shown to
 * somebody who has not already followed them.
 */
function showVoice(name) {
  if (name) {
    voiceHint.textContent = `Speaking with ${name}, on this machine. Mute from the tray icon.`;
    voiceHint.classList.remove('warn');
    return;
  }
  voiceHint.textContent =
    'Using a voice already installed on Windows, which sounds like one. For a '
    + 'better one, put piper.exe and a .onnx voice with its .onnx.json in the '
    + 'piper folder beside settings.json — it runs on this machine like '
    + 'everything else. Mute from the tray icon.';
}

// Which checkbox depends on something the operating system has to provide. A
// tick box for a capability this machine does not have is a promise the app
// then breaks, so those are switched off, disabled, and say why on hover.
//
// Only these two. Bopping and noticing you are Web Audio and a canvas diff in
// the renderer - they need a microphone and a camera, not an OS feature, and
// they work anywhere Electron does.
const NEEDS = { wake: 'wake', faces: 'faces' };

function showCapabilities(caps) {
  if (!Array.isArray(caps)) return;
  const by = Object.fromEntries(caps.map((c) => [c.name, c]));
  for (const [id, capability] of Object.entries(NEEDS)) {
    const box = el(id);
    const cap = by[capability];
    if (!box || !cap || cap.ready) continue;
    box.checked = false;
    box.disabled = true;
    const label = box.closest('label') || box.parentElement;
    if (label) {
      label.classList.add('unavailable');
      label.title = cap.why;
    }
  }
}

// ---- updates ----

// Nothing here runs on its own. The check happens because the button was
// pressed, the download happens because the second button was pressed, and
// between the two you are told which version it found.
function showUpdate(res) {
  updateInstall.hidden = res.state !== 'available';
  if (res.state === 'available') {
    updateStatus.textContent = `${res.latest} is out.`;
    return;
  }
  updateStatus.textContent =
    res.state === 'current' ? 'You have the newest one.'
    : res.state === 'dev' ? 'Only the installed app can update itself.'
    : res.why || 'The check did not go through.';
}

updateCheck.addEventListener('click', async () => {
  updateCheck.disabled = true;
  updateStatus.textContent = 'Checking…';
  updateInstall.hidden = true;
  try {
    showUpdate(await window.config.update.check());
  } finally {
    updateCheck.disabled = false;
  }
});

// Only resolves when it did not work: on success the app is already replacing
// itself and this window is on its way out with it.
updateInstall.addEventListener('click', async () => {
  updateCheck.disabled = true;
  updateInstall.disabled = true;
  updateStatus.textContent = 'Downloading…';
  const res = await window.config.update.install();
  if (!res.ok) {
    updateStatus.textContent = res.why || 'The download did not finish.';
    updateCheck.disabled = false;
    updateInstall.disabled = false;
  }
});

window.config.update.onProgress((percent) => {
  updateStatus.textContent = `Downloading… ${percent}%`;
});

// ---- panels ----

// Five panels rather than one scroll. Only the visible one is measured for
// clamping, because a hidden element has no height to measure.
const panels = Array.from(document.querySelectorAll('.panel'));
const tabs = Array.from(document.querySelectorAll('.tab'));

function showTab(name) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of panels) p.hidden = p.dataset.panel !== name;
  document.querySelector('main').scrollTop = 0;
  for (const h of document.querySelectorAll(`[data-panel="${name}"] .hint`)) clampHint(h);
}

for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab));

// Every word of the hints is kept - they are what the app promises about your
// screen, your microphone and your camera, and none of that is worth hiding
// behind a click you have to know to make. Two lines are always visible and the
// rest is one click away. A hint that already fits gets no button: measured
// rather than guessed, because the text is prose written for a fixed width and
// half of it fits.
function clampHint(hint) {
  if (!hint.offsetParent) return;
  const next = hint.nextElementSibling;
  if (next && next.classList.contains('more')) next.remove();
  hint.classList.remove('clamp');
  if (!hint.textContent.trim()) return;
  hint.classList.add('clamp');
  if (hint.scrollHeight <= hint.clientHeight + 1) return hint.classList.remove('clamp');
  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = 'more';
  more.addEventListener('click', () => {
    more.textContent = hint.classList.toggle('clamp') ? 'more' : 'less';
  });
  hint.after(more);
}

el('close').addEventListener('click', () => window.config.close());

(async () => {
  const data = await window.config.get();
  current = data.settings;
  skin = current.skin;
  species = current.pet;

  keysPresent = data.keys || {};
  fillProviders(data.providers || [{ name: 'ollama', label: 'Ollama — on this machine', local: true }],
    current.provider);
  fillModels(data.models, current.model, data.brain, data.advice);
  fillPets(data.pets);
  fillSkins(data.skins);
  fillWear(data.wear || ['none'], current.wear);
  paintPreviews();
  showVision(data.visionModel);
  showVoice(data.voiceName);
  showCapabilities(data.capabilities);

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
  // Shows what was accepted, not what was typed: a name that was all emoji
  // comes back empty, which is the honest answer.
  nameInput.value = current.name;
  voice.checked = current.voice;
  sounds.checked = current.sounds;
  focus.checked = current.focus;
  // Refused rather than clamped when a hosted provider is chosen, so what comes
  // back is what the app is actually going to do.
  watchBox.checked = current.watch;
  watchEvery.value = current.watchEvery;
  breaksBox.checked = current.breaks;
  // Clamped rather than rejected in settings.js, so what comes back is what the
  // app is actually going to do - typing 2 minutes and being shown 5 is the
  // point of putting it back in the box.
  breakEvery.value = current.breakEvery;
  breakFor.value = current.breakFor;
  mischief.checked = current.mischief;
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
  // Written rather than left in the markup so there is one version number in
  // the app and it comes from the app, not from a string somebody has to
  // remember to bump.
  // Unpackaged, `app.getVersion()` is Electron's own version rather than the
  // pet's, so it is not shown: a wrong number is worse than no number.
  el('version-hint').textContent = data.packaged
    ? `You are running ${data.version}.`
    : 'This is a development build - only an installed copy can replace itself.';
  updateCheck.disabled = !data.packaged;
  clampHint(el('version-hint'));
  el('autostart-hint').textContent = data.packaged
    ? ''
    : 'Only available in the packaged app - in development this would launch Electron itself.';
  clampHint(el('autostart-hint'));

  validate();
})();

showTab('pet');
