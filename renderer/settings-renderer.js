'use strict';

const el = (id) => document.getElementById(id);
const modelSel = el('model');
const visionSel = el('vision');
const hotkeyInput = el('hotkey');
const skinsBox = el('skins');
const autostart = el('autostart');
const status = el('status');
const saveBtn = el('save');

// Same shape check as settings.js. Duplicated deliberately: this one is only to
// disable the button early, the one in the main process is the real gate.
const ACCELERATOR = /^([A-Za-z0-9]+\+)*[A-Za-z0-9]+$/;

let current = null;
let skin = 'butter';

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
    });
    skinsBox.append(b);
  }
}

function showVision(visionModel) {
  const hint = el('vision-hint');
  hint.textContent = visionModel
    ? `Windows OCR reads text; ${visionModel} steps in when there is none to read.`
    : 'No vision-capable model installed, so text is read with Windows OCR. '
      + 'Pull one (for example moondream) to handle diagrams.';
  hint.classList.toggle('warn', !visionModel);
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

saveBtn.addEventListener('click', async () => {
  if (!validate()) return;
  status.textContent = 'Saving…';
  const res = await window.config.save({
    model: modelSel.value,
    vision: visionSel.value,
    hotkey: hotkeyInput.value.trim(),
    skin,
    autostart: autostart.checked,
  });
  current = res.settings;
  showVision(res.visionModel);
  // Reflect what was actually accepted - a rejected value silently reverting
  // would be worse than showing the user it did not stick.
  hotkeyInput.value = current.hotkey;
  status.textContent = 'Saved.';
});

el('close').addEventListener('click', () => window.config.close());

(async () => {
  const data = await window.config.get();
  current = data.settings;
  skin = current.skin;

  fillModels(data.models, current.model);
  fillSkins(data.skins);
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
  autostart.checked = current.autostart;
  autostart.disabled = !data.packaged;
  el('autostart-hint').textContent = data.packaged
    ? ''
    : 'Only available in the packaged app - in development this would launch Electron itself.';

  validate();
})();
