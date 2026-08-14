'use strict';

// Renderer check: loads the real UI, drives it through the real preload bridge,
// and asserts what came back over real IPC. Writes PNGs so you can look at it.
// Run: npm run verify:ui
//
// This exists because a top-level `const pet` in renderer.js silently collided
// with the contextBridge global and killed the whole script at parse time. Unit
// tests cannot see that; only rendering it can.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// This file lives in test/, the UI it loads lives in src/, and the PNGs it
// writes belong at the top of the repository, which is where the README looks.
const SRC = path.join(__dirname, '..', 'src');
const ROOT = path.join(__dirname, '..');

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

// A rejected executeJavaScript - a selector that matched nothing, usually -
// otherwise aborts the run silently and the app just sits there forever with a
// window open. Fail loudly instead; a hang tells you nothing.
process.on('unhandledRejection', (err) => {
  console.error(`FAIL - ${err && err.message ? err.message : err}`);
  app.exit(1);
});

app.whenReady().then(async () => {
  const errors = [];
  const ipc = {
    act: [], interactive: [], react: [], chat: [], chatOpen: [], photo: [], place: [],
    ask: 0, listen: 0,
  };
  ipcMain.on('pet:photo-taken', (_e, v) => ipc.photo.push(v));
  ipcMain.on('pet:listen', () => { ipc.listen += 1; });
  ipcMain.on('pet:act', (_e, name) => ipc.act.push(name));
  ipcMain.on('pet:interactive', (_e, v) => ipc.interactive.push(v));
  ipcMain.on('pet:react', (_e, v) => ipc.react.push(v));
  ipcMain.on('pet:place', (_e, v) => ipc.place.push(v));
  ipcMain.on('pet:chat', (_e, v) => ipc.chat.push(v));
  ipcMain.on('pet:chat-open', (_e, v) => ipc.chatOpen.push(v));
  ipcMain.on('pet:ask', () => { ipc.ask += 1; });

  const win = new BrowserWindow({
    width: 520,
    height: 300,
    // Must be shown: a hidden window throttles compositing and capturePage then
    // hands back a stale frame, which makes the PNGs quietly lie.
    show: true,
    backgroundColor: '#1b1b1f', // opaque so capturePage has something to composite
    webPreferences: {
      preload: path.join(SRC, 'preload.js'),
      backgroundThrottling: false,
    },
  });

  // Every mouse event this file cares about is dispatched into the DOM on
  // purpose. Left alive to the real pointer, a window that happens to open under
  // the cursor fires mousemove, which fires express('smile'), which replaces
  // whatever face was being checked - so the run failed on a different assertion
  // each time depending on where the mouse was sitting. Synthetic events are
  // unaffected by this; only the OS-delivered ones stop.
  win.setIgnoreMouseEvents(true);

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });
  win.webContents.on('preload-error', (_e, p, err) => errors.push(`preload ${p}: ${err.message}`));

  await win.loadFile(path.join(SRC, 'renderer', 'index.html'));
  const js = (src) => win.webContents.executeJavaScript(src);
  const shot = async (name) => {
    try {
      fs.writeFileSync(path.join(ROOT, name), (await win.webContents.capturePage()).toPNG());
    } catch (err) {
      // capturePage reports GPU failures with no clue which capture it was.
      throw new Error(`capturePage failed writing ${name}: ${err.message}`);
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 250));
  const shownOnScreen = async (id) =>
    (await js(`getComputedStyle(document.getElementById('${id}')).display`)) !== 'none';

  // Rendered state, not the .hidden property: an author `display` rule overrides
  // the UA [hidden] stylesheet, and the element stays on screen regardless.
  check(!(await shownOnScreen('menu')), 'menu is visible before anyone opened it');
  check(!(await shownOnScreen('bubble')), 'bubble is visible before the pet said anything');

  // --- speech -------------------------------------------------------------
  win.webContents.send('pet:say', { text: '17 x 23 = 391, so the answer is A.', kind: 'answer' });
  await settle();
  const bubble = await js(
    `(() => { const b = document.getElementById('bubble');
      return { hidden: b.hidden, text: b.innerText.trim() }; })()`
  );
  check(!bubble.hidden, 'bubble stayed hidden - renderer never handled pet:say');
  check(bubble.text.includes('391'), `bubble text wrong: ${JSON.stringify(bubble.text)}`);
  await shot('pet-preview.png');

  // --- stats drive mood and bars -----------------------------------------
  for (const [mood, stats] of Object.entries({
    happy: { fullness: 90, happiness: 90, energy: 80 },
    hungry: { fullness: 12, happiness: 60, energy: 70 },
    sad: { fullness: 60, happiness: 10, energy: 70 },
    sleepy: { fullness: 60, happiness: 60, energy: 10 },
    neutral: { fullness: 50, happiness: 50, energy: 50 },
  })) {
    win.webContents.send('pet:stats', { ...stats, bond: 10, mood });
    await settle();
    const got = await js(
      `(() => ({ mood: document.getElementById('pet').dataset.mood,
                 bar: document.querySelector('[data-bar="fullness"]').style.width,
                 bodyFill: getComputedStyle(document.querySelector('.body')).fill }))()`
    );
    check(got.mood === mood, `mood not applied: wanted ${mood}, got ${got.mood}`);
    check(
      got.bar === `${stats.fullness}%`,
      `fullness bar wrong for ${mood}: ${got.bar}`
    );
    if (mood === 'hungry') await shot('pet-hungry.png');
  }

  // Sleepy must actually close the eyes, not just recolour.
  win.webContents.send('pet:stats', { fullness: 60, happiness: 60, energy: 10, bond: 0, mood: 'sleepy' });
  await settle();
  const lids = await js(
    `(() => ({ eyes: getComputedStyle(document.querySelector('.eyes')).display,
               lids: getComputedStyle(document.querySelector('.lids')).display }))()`
  );
  check(lids.eyes === 'none' && lids.lids === 'block', 'sleepy pet did not close its eyes');

  // --- skins repaint the pet, and moods stay filters so they compose --------
  const fill = () => js(`getComputedStyle(document.querySelector('.body')).fill`);
  const butter = await fill();
  win.webContents.send('pet:look', { pet: 'blob', skin: 'mint' });
  await settle();
  const mint = await fill();
  check(mint !== butter, 'skin change did not repaint the pet');
  check(mint === 'rgb(127, 209, 176)', `mint skin wrong: ${mint}`);

  // A mood on top of a skin must tint, not overwrite the palette.
  win.webContents.send('pet:stats', { fullness: 60, happiness: 10, energy: 70, bond: 0, mood: 'sad' });
  await settle();
  check(await fill() === mint, 'mood overwrote the skin colour instead of filtering it');
  check(
    (await js(`getComputedStyle(document.querySelector('.pet svg')).filter`)) !== 'none',
    'sad mood applied no filter'
  );
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter' });
  await settle();

  // --- species -------------------------------------------------------------
  // Each pet is ear and extra geometry over one shared face rig, so the check
  // is that the geometry actually differs - not that an attribute was set.
  const earD = () => js(`getComputedStyle(document.querySelector('.ear-l')).d`);
  const blobEars = await earD();
  for (const [species, part] of Object.entries({
    cat: '.whiskers', pup: '.tail', bun: '.ear-l', bird: '.crest', dragon: '.crest',
    fox: '.tail', axolotl: '.ear-l', ghost: '.body', robot: '.crest',
  })) {
    win.webContents.send('pet:look', { pet: species, skin: 'butter' });
    await settle();
    const got = await js(
      `(() => ({ pet: document.documentElement.dataset.pet,
                 shown: getComputedStyle(document.querySelector('${part}')).display,
                 d: getComputedStyle(document.querySelector('${part}')).d }))()`
    );
    check(got.pet === species, `species not applied: wanted ${species}, got ${got.pet}`);
    check(got.shown !== 'none', `${species} did not show ${part}`);
    check(/path\(/.test(got.d), `${species} left ${part} with no shape (${got.d})`);
    // Two exceptions, and both are pets with no ears to reshape rather than
    // pets whose ear rule failed: the bird has a tuft, the ghost has nothing.
    if (species !== 'bird' && species !== 'ghost') {
      check(await earD() !== blobEars, `${species} wears the default ears`);
    }
  }

  // --- the wardrobe --------------------------------------------------------
  // Every outfit has to switch something on, switch it off again when another
  // one is picked, and none of them may take the face with it.
  const WEAR = require('../src/core/settings').WEAR;
  const WORN = {
    bow: '.bow', shades: '.shades', halo: '.halo', hero: '.cape',
    party: '.hat-party', wizard: '.hat-wizard', crown: '.crown', headphones: '.cans',
  };
  for (const outfit of WEAR) {
    if (outfit === 'none') continue;
    win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', wear: outfit });
    await settle();
    const got = await js(
      `(() => { const d = (sel) => getComputedStyle(document.querySelector(sel)).display;
         return { on: d('${WORN[outfit]}'), mask: d('.mask'), eyes: d('.eyes'),
                  worn: document.documentElement.dataset.wear }; })()`
    );
    check(got.worn === outfit, `wearing ${outfit} but the root says ${got.worn}`);
    check(got.on !== 'none', `${outfit} is on and ${WORN[outfit]} is not drawn`);
    // Only the hero wears the mask, and even then the eyes stay visible: it is
    // cut with holes, and a solid one would take the gaze and the blink with it.
    check(
      (got.mask !== 'none') === (outfit === 'hero'),
      `the mask is ${got.mask === 'none' ? 'off' : 'on'} while wearing ${outfit}`
    );
    check(got.eyes !== 'none', `${outfit} hides the eyes`);
  }
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', wear: 'none' });
  await settle();
  check(
    await js(`getComputedStyle(document.querySelector('.cape')).display`) === 'none',
    'taking the outfit off left the cape on'
  );

  // --- idle quirks ---------------------------------------------------------
  // Each species must move differently while nothing is happening. Checking the
  // resolved animation-name catches the failure that matters: a rule that never
  // matches leaves the pet on the default squish and looks unfinished.
  const quirks = new Set();
  for (const s of require('../src/core/settings').PETS) {
    win.webContents.send('pet:look', { pet: s, skin: 'butter' });
    await settle();
    const got = await js(
      `(() => { const p = document.getElementById('pet');
         p.classList.add('is-idling');
         const of = (sel) => getComputedStyle(document.querySelector(sel)).animationName;
         const out = { body: of('#pet'), gaze: of('.gaze'), tail: of('.tail') };
         p.classList.remove('is-idling');
         return out; })()`
    );
    check(got.body !== 'bob' && got.body !== 'none', `${s} has no idle quirk (${got.body})`);
    check(got.gaze === 'glance', `${s} does not look around while idle (${got.gaze})`);
    quirks.add(`${got.body}/${got.tail}`);
  }
  check(
    quirks.size >= require('../src/core/settings').PETS.length - 1,
    `the species share too few idle quirks: ${[...quirks].join(', ')}`
  );

  // The quirk has to end, or the pet never goes back to its resting bob.
  check(
    (await js(`getComputedStyle(document.getElementById('pet')).animationName`)) === 'bob',
    'the pet did not settle back into its bob after a quirk'
  );

  // A bird has no ears at all - the rule that hides them must reach both.
  win.webContents.send('pet:look', { pet: 'bird', skin: 'butter' });
  await settle();
  check(
    (await js(`getComputedStyle(document.querySelector('.ear-r')).display`)) === 'none',
    'the bird kept its ears'
  );

  // Species and skin are orthogonal: every pet has to work in every palette.
  win.webContents.send('pet:look', { pet: 'dragon', skin: 'slate' });
  await settle();
  check(
    (await js(`getComputedStyle(document.querySelector('.tail')).fill`)) === 'rgb(125, 139, 159)',
    'the tail did not follow the skin palette'
  );

  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter' });
  await settle();

  // --- interaction wiring, asserted over real IPC -------------------------
  await js(
    `(() => { const r = document.getElementById('pet').getBoundingClientRect();
       document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`
  );
  await settle();
  check(ipc.interactive.at(-1) === true, 'hovering the pet did not make the window clickable');

  await js(`document.getElementById('pet').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await settle();
  check(ipc.act.includes('pet'), 'clicking the pet did not send a headpat');

  await js(
    `document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`
  );
  await settle();
  check(await shownOnScreen('menu'), 'right-click did not open the menu');
  check(
    !(await shownOnScreen('bubble')),
    'menu and bubble are both showing - they occupy the same space'
  );
  await shot('pet-menu.png');

  await js(`document.querySelector('[data-act="feed"]').click()`);
  await settle();
  check(ipc.act.includes('feed'), 'Feed menu item did not send an action');

  await js(
    `document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
     document.querySelector('[data-ask]').click()`
  );
  await settle();
  check(ipc.ask === 1, 'Read screen menu item did not request an answer');

  // Menu disables what the pet would refuse anyway.
  win.webContents.send('pet:stats', { fullness: 98, happiness: 60, energy: 10, bond: 0, mood: 'sleepy' });
  await settle();
  const disabled = await js(
    `(() => ({ feed: document.querySelector('[data-act="feed"]').disabled,
               play: document.querySelector('[data-act="play"]').disabled }))()`
  );
  check(disabled.feed, 'Feed stayed enabled on a full pet');
  check(disabled.play, 'Play stayed enabled on an exhausted pet');

  // --- expressions --------------------------------------------------------
  // The whole expression system rests on CSS `d: path(...)` swapping the mouth.
  // If that ever stops resolving, every face silently becomes the default one
  // and nothing else here would notice, so check the geometry actually moved.
  const mouthD = () => js(`getComputedStyle(document.querySelector('.mouth')).d`);
  win.webContents.send('pet:stats', { fullness: 60, happiness: 60, energy: 60, bond: 0, mood: 'neutral' });
  await settle();
  const restingMouth = await mouthD();
  check(/path\(/.test(restingMouth), `CSS d: path() is not supported here: ${restingMouth}`);

  win.webContents.send('pet:stats', { fullness: 60, happiness: 10, energy: 60, bond: 0, mood: 'sad' });
  await settle();
  check(await mouthD() !== restingMouth, 'a sad pet wears the same mouth as a content one');

  for (const [expr, expected] of Object.entries({
    love: { sel: '.eyes-love', prop: 'display', want: 'block' },
    yum: { sel: '.tongue', prop: 'display', want: 'block' },
    sulk: { sel: '.sweat', prop: 'display', want: 'block' },
    oh: { sel: '.brows', prop: 'display', want: 'block' },
    giggle: { sel: '.lids', prop: 'display', want: 'block' },
    shy: { sel: '.bow', prop: 'display', want: 'block' },
    proud: { sel: '.spark', prop: 'display', want: 'block' },
    joy: { sel: '.mouth', prop: 'fill', want: 'rgb(138, 67, 64)' },
    annoyed: { sel: '.anger', prop: 'display', want: 'block' },
    rage: { sel: '.anger', prop: 'display', want: 'block' },
    cry: { sel: '.tear', prop: 'display', want: 'block' },
    // The keyboard half. Both props are new elements, so these two are the ones
    // that would break if the markup and the stylesheet ever drift apart.
    cool: { sel: '.shades', prop: 'display', want: 'block' },
    innocent: { sel: '.halo', prop: 'display', want: 'block' },
    huff: { sel: '.anger', prop: 'display', want: 'block' },
    pleading: { sel: '.bow', prop: 'display', want: 'block' },
    grimace: { sel: '.sweat', prop: 'display', want: 'block' },
    mischief: { sel: '.mouth', prop: 'fill', want: 'rgb(138, 67, 64)' },
  })) {
    win.webContents.send('pet:say', { text: 'hello', kind: 'chat', expr });
    await settle();
    const got = await js(
      `(() => ({ expr: document.getElementById('pet').dataset.expr,
                 value: getComputedStyle(document.querySelector('${expected.sel}')).${expected.prop} }))()`
    );
    check(got.expr === expr, `expression not applied: wanted ${expr}, got ${got.expr}`);
    check(got.value === expected.want, `${expr} did not show ${expected.sel} (${got.value})`);
    if (expr === 'love') await shot('pet-love.png');
  }

  // --- emoji rain -----------------------------------------------------------
  // A feeling with emoji drops them; one without stays quiet. The second half
  // matters more: 'smile' fires on every hover, and confetti on mouse move would
  // make the pet unusable.
  const drops = () => js(`document.querySelectorAll('#fx .drop').length`);
  win.webContents.send('pet:say', { text: 'yay', kind: 'chat', expr: 'joy' });
  await settle();
  check(await drops() > 0, 'joy dropped no emoji');
  check(
    (await js(`getComputedStyle(document.querySelector('#fx .drop')).animationName`)) === 'drop-in',
    'the emoji are in the DOM but not falling'
  );
  await shot('pet-rain.png');

  // One feeling at a time: a new one clears whatever is still falling, rather
  // than raining hearts through a tantrum.
  win.webContents.send('pet:say', { text: 'grr', kind: 'chat', expr: 'rage' });
  await settle();
  check(
    // Every character rage can drop, across all of its sets - it picks one at
    // random per burst, and naming only the first set made this pass or fail
    // depending on the coin toss.
    await js(`[...document.querySelectorAll('#fx .drop')].every((d) => '💢🔥⚡'.includes(d.textContent))`),
    'a new feeling left the old one still falling'
  );

  // Re-triggering the same feeling must re-run it, or a second poke mid-tantrum
  // changes nothing on screen. Measured by the animation clock going backwards.
  const age = () => js(`document.querySelector('#fx .drop').getAnimations()[0].currentTime`);
  await new Promise((r) => setTimeout(r, 400));
  const aged = await age();
  win.webContents.send('pet:say', { text: 'grr', kind: 'chat', expr: 'rage' });
  await settle();
  check(await age() < aged, 'the same expression twice in a row did nothing the second time');

  win.webContents.send('pet:say', { text: 'hi', kind: 'chat', expr: 'smile' });
  await new Promise((r) => setTimeout(r, 2800)); // outlast the drops already falling
  check(await drops() === 0, 'smile rains, and smile fires on every hover');

  // An expression must beat the mood it is laid over - same specificity, so this
  // is only true while the expression rules sit below the mood rules.
  win.webContents.send('pet:stats', { fullness: 60, happiness: 60, energy: 10, bond: 0, mood: 'sleepy' });
  win.webContents.send('pet:say', { text: 'oh!', kind: 'chat', expr: 'oh' });
  await settle();
  check(
    (await js(`getComputedStyle(document.querySelector('.eyes')).display`)) !== 'none',
    'a sleepy pet stayed asleep through a reaction - mood is winning the cascade'
  );

  // Thinking holds its face until the answer lands rather than timing out.
  win.webContents.send('pet:say', { text: 'thinking', kind: 'thinking' });
  await settle();
  check(await js(`document.getElementById('pet').dataset.expr`) === 'hmm', 'thinking has no face');
  win.webContents.send('pet:say', { text: '391.', kind: 'answer', expr: 'smile' });
  await settle();
  check(await js(`document.getElementById('pet').dataset.expr`) === 'smile', 'answer face never arrived');

  // --- gaze ---------------------------------------------------------------
  const eyeX = () => js(`document.getElementById('pet').style.getPropertyValue('--eye-x')`);
  await js(`document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }))`);
  await settle();
  const left = await eyeX();
  await js(`document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 0 }))`);
  await settle();
  check(left !== (await eyeX()), 'the eyes do not follow the cursor');

  // --- it turns to look at you ---------------------------------------------
  // The lighting makes a still frame look solid; this is the half that makes it
  // read as solid while it moves. A few degrees, and it has to actually reach
  // the group rather than sit on a custom property nothing consumes.
  await js(`document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 200 }))`);
  await settle();
  const leftTurn = await js(`getComputedStyle(document.querySelector('.turn')).transform`);
  await js(`document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 200 }))`);
  await settle();
  const rightTurn = await js(`getComputedStyle(document.querySelector('.turn')).transform`);
  check(leftTurn !== 'none', 'the head does not turn towards the cursor at all');
  check(leftTurn !== rightTurn, 'the head turns the same way whichever side the cursor is on');

  // Lit, not flat. The filters are one definition loaded by every document that
  // draws a pet, so a preview cannot be lit differently from the real thing.
  const lit = await js(`(() => {
    const holder = document.getElementById('pet-lighting');
    return {
      installed: !!holder,
      volume: !!document.getElementById('pet-volume'),
      soft: !!document.getElementById('pet-soft'),
      body: getComputedStyle(document.querySelector('.body')).filter,
      shadow: getComputedStyle(document.querySelector('.shadow')).filter,
      // A hidden subtree drops the filters with it, and the pet goes flat.
      shown: getComputedStyle(holder).display,
      room: holder.getBoundingClientRect().height,
    };
  })()`);
  check(lit.installed, 'nothing installed the lighting');
  check(lit.volume && lit.soft, 'the lighting filters are missing');
  check(lit.body.includes('pet-volume'), `the body is unlit: ${lit.body}`);
  check(lit.shadow.includes('pet-soft'), `the shadow is a hard ellipse: ${lit.shadow}`);
  check(lit.shown !== 'none', 'the filters are inside a display:none subtree, which drops them');
  check(lit.room === 0, `the filter holder takes up ${lit.room}px of the window`);

  // --- tickle and drag ----------------------------------------------------
  await js(`document.getElementById('pet').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await settle();
  check(ipc.act.includes('tickle'), 'double-click did not tickle the pet');

  await js(
    `(() => { const p = document.getElementById('pet');
       const r = p.getBoundingClientRect(), y = r.top + r.height / 2;
       const at = (t, x) => document.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }));
       p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0,
         clientX: r.left + r.width / 2, clientY: y }));
       at('mousemove', r.left + r.width / 2 + 80);
       at('mouseup', r.left + r.width / 2 + 80); })()`
  );
  await settle();
  check(ipc.react.includes('drag'), 'dragging the pet sent no reaction');
  check(
    (await js(`document.getElementById('stage').style.transform`)) !== '',
    'dragging did not move the pet'
  );

  // A drag ends in a click event, which must not also register as a headpat.
  const patsBefore = ipc.act.filter((a) => a === 'pet').length;
  await js(
    `(() => { const p = document.getElementById('pet'), r = p.getBoundingClientRect();
       p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + 10, clientY: r.top + 10 }));
       document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 90, clientY: r.top + 10 }));
       document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 90, clientY: r.top + 10 }));
       p.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`
  );
  await settle();
  check(
    ipc.act.filter((a) => a === 'pet').length === patsBefore,
    'dropping the pet counted as a headpat'
  );

  // --- put it anywhere, but never off the screen ---------------------------
  // The one thing a desktop pet must never do is end up somewhere you cannot
  // reach it. Every corner is tried by hand rather than trusting one clamp:
  // there are two axes, and the vertical one flips which edge the stage hangs
  // off partway up, which is exactly where an off-by-one lives.
  const dragTo = (x, y) => js(
    `(() => { const p = document.getElementById('pet'), r = p.getBoundingClientRect();
       p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
       for (const t of ['mousemove', 'mouseup'])
         document.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: ${x}, clientY: ${y} }));
     })()`
  );
  // Taller than the rest of this run needs: this window is 520x300, and at that
  // height every position on it is inside the bubble reserve, so the flip could
  // never be seen going back. A display is not 238 pixels tall.
  win.setSize(520, 760);
  await settle();

  const petBox = () => js(
    `(() => { const r = document.getElementById('pet').getBoundingClientRect();
       return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                w: innerWidth, h: innerHeight,
                flip: document.getElementById('stage').dataset.flip }; })()`
  );

  for (const [name, x, y] of [
    ['the top left', -4000, -4000],
    ['the top right', 9000, -4000],
    ['the bottom right', 9000, 9000],
    ['the bottom left', -4000, 9000],
  ]) {
    await dragTo(x, y);
    await settle();
    const b = await petBox();
    check(
      b.left >= -1 && b.top >= -1 && b.right <= b.w + 1 && b.bottom <= b.h + 1,
      `shoved at ${name} the pet left the screen: ${JSON.stringify(b)}`
    );
  }

  // Vertical placement is the new half, so it is checked for having actually
  // happened rather than only for staying in bounds. Relative to the window:
  // this one is 520x300, not a display.
  const floor = (await petBox()).top;
  await dragTo(300, Math.round((await petBox()).h / 2));
  await settle();
  const mid = await petBox();
  check(mid.top < floor - 30, `the pet did not move up the screen: ${mid.top} of ${floor}`);

  // Up there the bubble would be off the top of the window, so everything that
  // sits above the pet flips to below it. Without this the answer is drawn
  // outside the window and simply is not there.
  await dragTo(300, 20);
  await settle();
  const high = await petBox();
  check(high.flip === 'down', `near the top the stage did not flip: ${high.flip}`);
  win.webContents.send('pet:say', { text: 'can you still read me up here?', kind: 'chat', expr: 'smile' });
  await settle();
  const bub = await js(
    `(() => { const r = document.getElementById('bubble').getBoundingClientRect();
       const p = document.getElementById('pet').getBoundingClientRect();
       return { top: r.top, bottom: r.bottom, h: innerHeight, below: r.top >= p.top }; })()`
  );
  check(bub.top >= 0 && bub.bottom <= bub.h, `the bubble is off the screen: ${JSON.stringify(bub)}`);
  check(bub.below, 'the bubble stayed above a pet that has no room above it');

  // Down again, where it flips back.
  await dragTo(300, mid.h + 500);
  await settle();
  const back = await petBox();
  check(back.flip === 'up', `the stage stayed flipped once back on the floor: ${JSON.stringify(back)}`);

  // Thrown, it keeps going after you let go. Dispatched with real gaps between
  // the moves: the release speed is measured off the last few positions, and
  // events fired in one tick have no speed in them at all - which is also the
  // guard that stops a stationary click from firing the pet across the screen.
  await dragTo(120, 120);
  await settle();
  const from = await petBox();
  await js(`(async () => {
    const p = document.getElementById('pet'), r = p.getBoundingClientRect();
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    let x = r.left + r.width / 2;
    for (let i = 0; i < 5; i++) {
      x += 34;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: 130 }));
      await wait(24);
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: 130 }));
  })()`);
  const released = await js(`stageX`);
  check((await js(`flight !== null`)) === true, 'a throw did not become a flight');
  await new Promise((r) => setTimeout(r, 2500));
  const landed = await petBox();
  check((await js(`flight === null`)) === true, 'the pet is still flying seconds later');
  check(landed.left > released, `the pet stopped dead where it was let go: ${landed.left} vs ${released}`);
  check(landed.bottom <= landed.h + 1, 'a thrown pet went through the floor');
  check(landed.bottom > landed.h - 40, `a thrown pet did not fall to the floor: ${landed.bottom} of ${landed.h}`);
  check(
    (await js(`document.getElementById('pet').style.transform`)) === '',
    'the pet is left rotated where it landed'
  );

  // A drag that ends without moving must never be read as a throw. Dividing a
  // distance by nearly no time is how a stationary pet ends up across the room.
  const still = await petBox();
  await dragTo(still.left + 200, still.top);
  await settle();
  check((await js(`flight === null`)) === true, 'a same-tick drag was measured as a throw');

  // Placed by hand is remembered by the main process, and the pet stops
  // wandering off on its own from that point.
  check(!!ipc.place.length, 'placing the pet told main nothing, so it is forgotten on restart');
  const at = ipc.place.at(-1);
  check(
    at && at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1,
    `the saved placement is not a pair of fractions: ${JSON.stringify(at)}`
  );
  check((await js(`placed`)) === true, 'a hand-placed pet still wanders off on its own');

  win.setSize(520, 300);
  await settle();
  // Back on a short window the pet must still be on it - the clamp runs on
  // resize, or a pet parked low on a tall display ends up under a short one.
  const shrunk = await petBox();
  // Instantly, not over the 2.6 second walk: mid-glide the pet is outside the
  // window it was just clamped into, which is exactly the moment a resolution
  // change happens.
  check(
    shrunk.bottom <= shrunk.h + 1 && shrunk.top >= -1,
    `resizing the window left the pet outside it: ${JSON.stringify(shrunk)}`
  );

  // --- chat ---------------------------------------------------------------
  await js(
    `document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
     document.querySelector('[data-talk]').click()`
  );
  await settle();
  check(await shownOnScreen('chat'), 'Talk did not open the chat box');
  check(ipc.chatOpen.at(-1) === true, 'chat opened without asking main for focus');
  check(!(await shownOnScreen('menu')), 'the menu stayed open behind the chat box');
  await shot('pet-chat.png');

  await js(
    `(() => { const i = document.getElementById('chat-input');
       i.value = 'how are you?';
       document.getElementById('chat').dispatchEvent(new Event('submit', { cancelable: true })); })()`
  );
  await settle();
  check(ipc.chat.at(-1) === 'how are you?', `chat message never sent: ${ipc.chat.at(-1)}`);
  check(!(await shownOnScreen('chat')), 'chat box stayed open after sending');
  check(ipc.chatOpen.at(-1) === false, 'chat closed without handing focus back');
  check(
    (await js(`document.getElementById('chat-input').value`)) === '',
    'chat box kept the last message in it'
  );

  // --- voice ---------------------------------------------------------------
  // The Listen entry only exists once the microphone is switched on. A menu item
  // that is present but only tells you the feature is off is worse than no item.
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: false, mic: false });
  await settle();
  await js(`document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`);
  await settle();
  const listenShown = () =>
    js(`getComputedStyle(document.querySelector('[data-listen]')).display !== 'none'`);
  check(!(await listenShown()), 'Listen is offered while the microphone is switched off');

  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: true, mic: true });
  await settle();
  check(await listenShown(), 'Listen never appears even with the microphone on');
  await js(`document.querySelector('[data-listen]').click()`);
  await settle();
  check(ipc.listen === 1, `Listen sent ${ipc.listen} requests to main, wanted 1`);

  // Every voice the pet may use has to be one this machine renders itself. Some
  // platforms list network-rendered voices next to the installed ones and
  // nothing but this flag tells them apart.
  const voices = await js(
    `speechSynthesis.getVoices().map((v) => ({ name: v.name, local: v.localService }))`
  );
  const speaking = () => js(`speechSynthesis.speaking || speechSynthesis.pending`);
  if (voices.length) check(voices.some((v) => v.local), 'no local voice at all - the pet is mute');

  // Muted is muted. Checked before the audible case, so a failure here cannot be
  // masked by an utterance the next block queued.
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: false, mic: false });
  win.webContents.send('pet:say', { text: 'this must stay silent', kind: 'chat', expr: 'smile' });
  await settle();
  check(!(await speaking()), 'the pet spoke out loud while muted');

  if (voices.length) {
    win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: true, mic: false });
    win.webContents.send('pet:say', { text: 'hi', kind: 'chat', expr: 'smile' });
    await settle();
    check(await speaking(), 'the pet stays silent with the voice switched on');
    await js(`speechSynthesis.cancel()`);
  }

  // 'thinking' is a placeholder with an animated ellipsis after it, not a line
  // to read out every time the model takes a moment.
  win.webContents.send('pet:say', { text: 'thinking', kind: 'thinking' });
  await settle();
  check(!(await speaking()), 'the pet reads "thinking" out loud');
  win.webContents.send('pet:say', { text: 'done', kind: 'answer', expr: 'smile' });
  await settle();
  await js(`speechSynthesis.cancel()`);
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: false, mic: false });
  await settle();

  // --- little noises --------------------------------------------------------
  // The unit tests can check that every species has a recipe. Only an audio
  // context can answer whether the recipe makes a sound, so each one is rendered
  // offline here and measured: a silent bark and a clipping one both pass every
  // check that does not listen.
  // Every species in every feeling, not just the pleased one. A face is picked
  // per feeling rather than a feeling named directly, because feelingOf() is the
  // thing the app actually calls and a mapping that drifts would otherwise leave
  // a hand-written hiss unreachable while this file happily rendered it.
  const FACE_OF = { neutral: 'hmm', happy: 'smile', sad: 'cry', cross: 'rage', sleepy: 'doze' };
  const barks = await js(`(async () => {
    const out = {};
    for (const species of Object.keys(VOICES)) {
      for (const [feeling, face] of Object.entries(${JSON.stringify(FACE_OF)})) {
        // Two seconds: a moan and a snore are both longer than a bark, and a
        // render that stops at one second would measure them as cut short.
        const off = new OfflineAudioContext(1, 88200, 44100);
        const end = sound(off, species, face);
        const d = (await off.startRendering()).getChannelData(0);
        let peak = 0;
        let voiced = 0;
        for (let i = 0; i < d.length; i++) {
          const v = Math.abs(d[i]);
          if (v > peak) peak = v;
          if (v > 0.002) voiced++;
        }
        out[species + '/' + feeling] = {
          peak, ms: Math.round((voiced / 44100) * 1000), end,
          call: !!callFor(species, feeling),
        };
      }
    }
    return out;
  })()`);

  for (const [name, b] of Object.entries(barks)) {
    check(b.peak > 0.01, `the ${name} makes no sound: peak ${b.peak.toFixed(4)}`);
    check(b.peak < 1, `the ${name} clips: peak ${b.peak.toFixed(3)}`);
    // Long enough to hear, short enough to be a noise rather than a ringtone.
    // A purpose-written call is allowed to run longer: a ghost's moan and a
    // dragon's snore are long *because* that is what makes them read as one.
    const ceiling = b.call ? 900 : 700;
    check(b.ms >= 40 && b.ms <= ceiling, `the ${name} lasts ${b.ms}ms (max ${ceiling})`);
    check(b.end < 2, `the ${name} was scheduled past the end of the render`);
  }

  // A feeling that sounds identical to neutral has not been expressed. Every
  // hand-written call must actually differ from the voice it replaced - this is
  // the check that a table of thirty-odd recipes is doing anything at all.
  const distinct = await js(`(async () => {
    const render = async (species, face) => {
      const off = new OfflineAudioContext(1, 88200, 44100);
      sound(off, species, face);
      const d = (await off.startRendering()).getChannelData(0);
      // A coarse fingerprint: energy in eight slices of time. Two sounds with the
      // same shape here are the same sound for a listener at the edge of a screen.
      // Over the first second only, and finely: eight slices of two seconds put
      // every one of the bird's 200ms calls in the same bucket, rounded to the
      // same integer, and reported two obviously different chirps as identical.
      const N = 32;
      const span = 44100 / N;
      const bins = new Array(N).fill(0);
      for (let i = 0; i < 44100; i++) bins[Math.floor(i / span)] += d[i] * d[i];
      return bins.map((x) => Math.round(Math.sqrt(x / span) * 100000));
    };
    const out = [];
    for (const species of Object.keys(VOICES)) {
      const base = (await render(species, 'hmm')).join(',');
      for (const [feeling, face] of Object.entries(${JSON.stringify(FACE_OF)})) {
        if (feeling === 'neutral' || !callFor(species, feeling)) continue;
        out.push([species + '/' + feeling, (await render(species, face)).join(',') !== base]);
      }
    }
    return out;
  })()`);

  check(distinct.length >= 25, `only ${distinct.length} feelings have a voice of their own`);
  for (const [name, differs] of distinct) {
    check(differs, `the ${name} call sounds exactly like the ordinary voice`);
  }

  // The feeling has to reach the sound and not only the face. Sleepy is slower
  // than happy, so the same recipe has to run longer.
  const bent = await js(`(() => {
    const at = (expr) => sound(new OfflineAudioContext(1, 44100, 44100), 'cat', expr);
    return { happy: at('love'), sleepy: at('doze') };
  })()`);
  check(bent.sleepy > bent.happy * 1.3, 'a sleepy pet sounds exactly like a happy one');

  // Muted is muted here too, and no audio context is opened at all: the setting
  // is checked before anything is created, not after.
  win.webContents.send('pet:look', { pet: 'pup', skin: 'butter', sounds: false });
  win.webContents.send('pet:say', { text: 'quiet please', kind: 'chat', expr: 'smile' });
  await settle();
  check((await js(`sfx === null`)) === true, 'the pet opened an audio context while muted');

  win.webContents.send('pet:look', { pet: 'pup', skin: 'butter', sounds: true });
  win.webContents.send('pet:say', { text: 'woof', kind: 'chat', expr: 'smile' });
  await settle();
  check((await js(`sfx !== null`)) === true, 'the pet never made a sound with noises on');
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', sounds: false });
  await settle();

  // --- chirp speech ---------------------------------------------------------
  // The pet's own lines are blips rather than a Windows voice reading them out.
  // Only a render can say whether that is a sound at all - the first purr in
  // this file rendered as silence - so the same measurements apply.
  const chirps = await js(`(async () => {
    const render = async (text, expr) => {
      const off = new OfflineAudioContext(1, 132300, 44100); // three seconds
      const end = chatter(off, text, expr);
      const d = (await off.startRendering()).getChannelData(0);
      let peak = 0, voiced = 0, sum = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
        if (v > 0.002) voiced++;
        sum += d[i] * d[i];
      }
      return { peak, ms: Math.round((voiced / 44100) * 1000), end, rms: Math.sqrt(sum / d.length) };
    };
    const line = 'you have been staring at that for eleven minutes now';
    return {
      short: await render('oh!', 'smile'),
      long: await render(line, 'smile'),
      huge: await render('aeiou '.repeat(80), 'smile'),
      same: await render('the same line twice', 'smile'),
      again: await render('the same line twice', 'smile'),
      asked: await render('are you there?', 'smile'),
      told: await render('are you there.', 'smile'),
      sad: await render(line, 'cry'),
      empty: await render('   ', 'smile'),
    };
  })()`);

  for (const name of ['short', 'long', 'sad']) {
    const c = chirps[name];
    check(c.peak > 0.01, `the ${name} chirp makes no sound: peak ${c.peak.toFixed(4)}`);
    check(c.peak < 1, `the ${name} chirp clips: peak ${c.peak.toFixed(3)}`);
    check(c.end < 3, `the ${name} chirp was scheduled past the end of the render`);
  }
  check(chirps.long.ms > chirps.short.ms, 'a long line chirps for no longer than a short one');
  // Capped, or a long line turns into a modem handshake.
  check(chirps.huge.ms <= 1200, `a 480 character line chirps for ${chirps.huge.ms}ms`);
  // The same sentence has to sound the same, or it reads as noise rather than a
  // voice. That is the whole job of the seed.
  check(
    chirps.same.rms.toFixed(6) === chirps.again.rms.toFixed(6),
    'the same line chirps differently every time'
  );
  check(chirps.asked.rms !== chirps.told.rms, 'a question chirps exactly like a statement');
  check(chirps.empty.peak === 0, 'an empty line still made a noise');
  // The feeling reaches the chirps too: the same words, said miserably, are slower.
  check(chirps.sad.ms > chirps.long.ms, 'a miserable pet chirps exactly like a cheerful one');

  // The two noises the pet's body makes rather than its voice. Measured the same
  // way as everything else here: a footfall that renders as silence is a walk
  // with nothing under it, and a thud that clips is worse than no thud.
  const room = await js(`(async () => {
    const render = async (make) => {
      const off = new OfflineAudioContext(1, 44100, 44100);
      make(off);
      const d = (await off.startRendering()).getChannelData(0);
      let peak = 0, voiced = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
        if (v > 0.002) voiced++;
      }
      return { peak, ms: Math.round((voiced / 44100) * 1000) };
    };
    return {
      step: await render((c) => step(c)),
      soft: await render((c) => thud(c, 0.2)),
      hard: await render((c) => thud(c, 1)),
    };
  })()`);
  for (const [name, n] of Object.entries(room)) {
    check(n.peak > 0.004, `the ${name} makes no sound: peak ${n.peak.toFixed(4)}`);
    check(n.peak < 1, `the ${name} clips: peak ${n.peak.toFixed(3)}`);
  }
  // A footfall is a tick, not a note. Eight of them go past in one walk.
  check(room.step.ms <= 90, `a footstep lasts ${room.step.ms}ms, which is a drum`);
  // Dropped two pixels and thrown across the screen must not sound the same.
  // That they do is what gives away that neither of them is real.
  check(
    room.hard.peak > room.soft.peak * 1.8,
    `a hard landing is no louder than a gentle one: ${room.hard.peak.toFixed(3)} vs ${room.soft.peak.toFixed(3)}`
  );

  // End to end through the real bridge. A line the pet came up with itself moves
  // its mouth without handing anything to the platform synthesiser; an answer
  // you asked for is still spoken in words.
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: true, sounds: false, mic: false });
  win.webContents.send('pet:say', { text: 'I am RIGHT HERE', kind: 'chat', expr: 'annoyed', chatter: true });
  await settle();
  check(!(await speaking()), 'the pet read its own line out loud instead of chirping it');
  check(
    (await js(`document.getElementById('pet').classList.contains('is-talking')`)) === true,
    'chirping does not move the mouth'
  );
  if (voices.length) {
    win.webContents.send('pet:say', { text: 'the answer is 391', kind: 'answer', expr: 'proud' });
    await settle();
    check(await speaking(), 'an answer was chirped rather than spoken out loud');
    await js(`speechSynthesis.cancel()`);
  }
  win.webContents.send('pet:look', { pet: 'blob', skin: 'butter', voice: false, sounds: false, mic: false });
  await settle();

  // --- body movements -------------------------------------------------------
  // The face and the body are separate axes, and the point of separating them is
  // that both can run at once. If a movement ever lands on .pet instead of the
  // svg inside it, one animation silently replaces the other and the pet stops
  // reacting while it moves - which is exactly the bug this checks for.
  const moves = await js(`Object.keys(MOVE_MS)`);
  check(moves.length >= 6, `only ${moves.length} movements defined`);

  for (const name of moves) {
    win.webContents.send('pet:say', { text: 'watch', kind: 'chat', expr: 'rage', move: name });
    await settle();
    const got = await js(
      `(() => ({ move: document.getElementById('pet').dataset.move,
                 anim: getComputedStyle(document.querySelector('.pet svg')).animationName,
                 expr: document.getElementById('pet').dataset.expr,
                 anger: getComputedStyle(document.querySelector('.anger')).display }))()`
    );
    check(got.move === name, `movement not applied: wanted ${name}, got ${got.move}`);
    check(got.anim !== 'none', `${name} set no animation on the body`);
    // The face has to survive the movement. A pet that goes blank while it moves
    // is the collision this design exists to avoid.
    check(got.expr === 'rage', `${name} wiped the expression (${got.expr})`);
    check(got.anger === 'block', `${name} wiped the angry face's anger mark`);
  }

  // An unknown movement must clear rather than stick a bad attribute on.
  await js(`move('moonwalk')`);
  check(
    !(await js(`document.getElementById('pet').dataset.move || ''`)),
    'an unknown movement was applied anyway'
  );
  win.webContents.send('pet:say', { text: 'ok', kind: 'chat', expr: 'smile' });
  await settle();

  // --- the camera -----------------------------------------------------------
  // Not switched on here: getUserMedia in a test would prompt, and the point
  // being checked is that it stays shut and says so.
  check(!(await shownOnScreen('cam')), 'the camera light is on before anyone enabled it');
  check(
    !(await js(`!!document.getElementById('cam-video').srcObject`)),
    'a camera stream is open with the camera switched off'
  );
  // The frames never get anywhere near full size: whatever the sensor gives, the
  // canvas everything is measured from is 32x24.
  const canvas = await js(
    `(() => { const c = document.getElementById('cam-canvas');
              return { w: c.width, h: c.height }; })()`
  );
  check(canvas.w <= 64 && canvas.h <= 48, `camera canvas is ${canvas.w}x${canvas.h}, too big to be blind`);

  // Asked for a photo with no camera open, the renderer still has to answer.
  // Staying silent would leave main waiting forever and the pet would look like
  // it had simply ignored you.
  win.webContents.send('pet:photo');
  await settle();
  check(ipc.photo.length === 1, `a photo request got ${ipc.photo.length} replies`);
  check(ipc.photo[0] == null, 'the renderer sent a frame with the camera shut');

  // --- contact sheets ------------------------------------------------------
  // Assertions above prove each face and each species changes something. These
  // are here so a human can see whether the something looks like a feeling, or
  // like a pet, rather than like a glitch.
  //
  // Each sheet gets its own window. Resizing and reloading the window under test
  // to build them made capturePage fail with UnknownVizError on the second one,
  // and it left the main window with its #stage torn out for every later check.

  // Built with cloneNode and individual style setters, never innerHTML or
  // cssText: the CSP forbids style attributes, and the live pet carries one
  // (the gaze offset), so cloning its markup as text trips the policy.
  const CLONE = `(source, cell) => {
    const p = source.cloneNode(true);
    p.removeAttribute('id');
    p.removeAttribute('style');
    p.style.animation = 'none';
    // Descendants too, or the sheet catches each pet at a random frame of its
    // own animation and the geometry cannot be judged.
    for (const el of p.querySelectorAll('*')) el.style.animation = 'none';
    p.dataset.mood = 'neutral';
    cell.append(p);
    return p;
  }`;

  async function sheet(name, [w, h], build) {
    const sw = new BrowserWindow({
      width: w, height: h, show: true, backgroundColor: '#fffdf7',
      webPreferences: {
        preload: path.join(SRC, 'preload.js'),
        backgroundThrottling: false,
      },
    });
    sw.webContents.on('console-message', (e) => {
      if (e.level === 'error') errors.push(`${name}: ${e.message}`);
    });
    await sw.loadFile(path.join(SRC, 'renderer', 'index.html'));
    sw.setContentSize(w, h);
    await sw.webContents.executeJavaScript(
      `(() => { const clone = ${CLONE};
         const source = document.getElementById('pet');
         const box = document.createElement('div');
         (${build})(source, box, clone);
         document.getElementById('stage').remove();
         document.body.style.background = '#fffdf7';
         document.body.append(box); })()`
    );
    await settle();
    try {
      fs.writeFileSync(path.join(ROOT, name), (await sw.webContents.capturePage()).toPNG());
    } catch (err) {
      throw new Error(`capturePage failed writing ${name}: ${err.message}`);
    }
    sw.destroy();
  }

  const faces = [
    'blank', 'smile', 'grin', 'love', 'yum', 'giggle', 'oh', 'hmm', 'sulk', 'dizzy',
    'shy', 'proud', 'joy', 'annoyed', 'rage', 'cry',
    'listen', 'curious', 'wink', 'doze', 'oops',
    // The ones you can ask for by name or emoji. Every entry in FACES, so a face
    // added to the keyboard and never drawn shows up here as a blank cell.
    'smug', 'cool', 'eyeroll', 'pleading', 'huff', 'flushed', 'grimace', 'shock',
    'deadpan', 'melt', 'starstruck', 'mischief', 'queasy', 'mindblown', 'shush',
    'innocent', 'wry', 'hug', 'wistful',
  ];
  await sheet('pet-faces.png', [660, 1160], `(source, box, clone) => {
    box.style.display = 'flex';
    box.style.flexWrap = 'wrap';
    for (const f of ${JSON.stringify(faces)}) {
      const cell = document.createElement('div');
      cell.style.width = '124px';
      cell.style.textAlign = 'center';
      const p = clone(source, cell);
      if (f !== 'blank') p.dataset.expr = f;
      const label = document.createElement('div');
      label.textContent = f;
      label.style.fontSize = '11px';
      label.style.color = '#8a7f6d';
      label.style.marginTop = '-8px';
      cell.append(label);
      box.append(cell);
    }
  }`);

  // Movements are time-based, so unlike the faces they show nothing at all in a
  // still. Each is caught partway through instead: a negative delay seeks into
  // the animation, and pausing holds it there. The moment picked for each is the
  // one that has to look right - the apex of the jump, the pet on the floor.
  const movesAt = [
    ['walk', '-0.30s'], ['dance', '-0.26s'], ['spin', '-0.20s'],
    ['jump', '-0.23s'], ['topple', '-0.95s'], ['peek', '-0.55s'],
    // The moment that has to look right for each of the new ones: the hold at
    // the bottom of the sit, the top of the stretch, halfway through the roll -
    // which is the frame where it is upside down - and the snap of the sneeze.
    ['sit', '-1.00s'], ['stretch', '-0.55s'], ['roll', '-0.45s'],
    ['sneeze', '-0.55s'], ['shiver', '-0.045s'],
  ];
  await sheet('pet-moves.png', [920, 380], `(source, box, clone) => {
    box.style.display = 'flex';
    box.style.flexWrap = 'wrap';
    for (const [name, at] of ${JSON.stringify(movesAt)}) {
      const cell = document.createElement('div');
      cell.style.width = '150px';
      cell.style.textAlign = 'center';
      const p = clone(source, cell);
      p.dataset.move = name;
      // clone() blanks every descendant animation so the faces sit still. Both
      // halves of a movement need theirs back: the body, and the shadow that
      // counter-rotates against it. Restoring only the body made this sheet
      // report a shadow standing on its edge that the app does not actually
      // have - the still was wrong, not the stylesheet.
      for (const el of [p.querySelector('svg'), p.querySelector('.shadow')]) {
        el.style.animation = '';
        el.style.animationDelay = at;
        el.style.animationPlayState = 'paused';
      }
      const label = document.createElement('div');
      label.textContent = name;
      label.style.fontSize = '11px';
      label.style.color = '#8a7f6d';
      cell.append(label);
      box.append(cell);
    }
  }`);

  // One outfit per row, every species in it. Nothing in the wardrobe is
  // species-aware, so this is the sheet that shows what that costs: a hat has to
  // read as a hat on a bun's ears and over a bird's crest, or it needs redrawing.
  await sheet('pet-wardrobe.png', [1260, 1000], `(source, box, clone) => {
    box.style.display = 'grid';
    box.style.gridTemplateColumns = 'repeat(10, 124px)';
    for (const outfit of ${JSON.stringify(WEAR.filter((w) => w !== 'none'))}) {
      for (const s of ${JSON.stringify(require('../src/core/settings').PETS)}) {
        const cell = document.createElement('div');
        cell.dataset.pet = s;
        cell.dataset.wear = outfit;
        cell.style.textAlign = 'center';
        clone(source, cell);
        box.append(cell);
      }
    }
  }`);

  const allSpecies = require('../src/core/settings').PETS;
  await sheet('pet-species.png', [1260, 1190], `(source, box, clone) => {
    box.style.display = 'grid';
    box.style.gridTemplateColumns = 'repeat(10, 124px)';
    for (const skin of ${JSON.stringify(require('../src/core/settings').SKINS)}) {
      for (const s of ${JSON.stringify(allSpecies)}) {
        const cell = document.createElement('div');
        cell.dataset.pet = s;
        cell.dataset.skin = skin;
        cell.style.textAlign = 'center';
        clone(source, cell);
        box.append(cell);
      }
    }
  }`);

  // --- settings window ----------------------------------------------------
  let saved = null;
  ipcMain.handle('config:get', async () => ({
    settings: {
      model: 'llama3.1:8b', vision: 'auto', hotkey: 'CommandOrControl+Shift+Space',
      pet: 'cat', skin: 'butter', wear: 'none',
      autostart: false, ollama: 'http://127.0.0.1:11434',
      mic: true, dictation: 'local',
      memory: true, cheek: true,
      network: false, web: false, weather: false, city: '',
      provider: 'ollama', providerModel: '',
    },
    // The real lists, not a copy of them: a settings window offering four skins
    // while the app has ten is a bug this file exists to catch.
    skins: require('../src/core/settings').SKINS,
    pets: require('../src/core/settings').PETS,
    wear: require('../src/core/settings').WEAR,
    models: ['llama3.1:8b', 'mistral:7b'],
    visionModel: null,
    packaged: false,
    providers: Object.entries(require('../src/core/providers').PROVIDERS).map(([name, spec]) => ({
      name, label: spec.label, local: spec.local === true,
      model: spec.model || '', keys: spec.keys || '',
    })),
    keys: {},
  }));
  ipcMain.handle('config:save', async (_e, patch) => {
    saved = patch;
    return { settings: { ...patch, ollama: 'http://127.0.0.1:11434' }, visionModel: null };
  });

  const sw = new BrowserWindow({
    width: 460, height: 940, show: true, // must match openSettings() in main.js
    webPreferences: {
      preload: path.join(SRC, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  sw.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(`settings: ${e.message}`);
  });
  await sw.loadFile(path.join(SRC, 'renderer', 'settings.html'));
  await settle();
  const sjs = (src) => sw.webContents.executeJavaScript(src);

  check(
    (await sjs(`document.querySelectorAll('#model option').length`)) === 2,
    'settings did not list the installed models'
  );
  check(
    (await sjs(`document.querySelectorAll('#skins .swatch').length`))
      === require('../src/core/settings').SKINS.length,
    'settings did not render the skin swatches'
  );
  check(
    (await sjs(`document.querySelectorAll('#pets .pet-pick svg').length`))
      === require('../src/core/settings').PETS.length,
    'settings did not draw a preview for every pet'
  );
  check(
    await sjs(`document.querySelector('#pets [data-pet="cat"]').getAttribute('aria-pressed') === 'true'`),
    'settings did not preselect the saved pet'
  );
  // The previews are drawn by pets.css, so a species must actually differ there
  // too - otherwise you are picking between six identical buttons.
  check(
    (await sjs(
      `getComputedStyle(document.querySelector('#pets [data-pet="cat"] .whiskers')).display`
    )) !== 'none',
    'the cat preview has no whiskers - pets.css is not reaching the settings window'
  );
  // Picking a skin must repaint them, or the preview lies about what you get.
  await sjs(`document.querySelector('[data-skin="mint"]').click()`);
  await settle();
  check(
    (await sjs(`getComputedStyle(document.querySelector('#pets .body')).fill`)) === 'rgb(127, 209, 176)',
    'skin choice did not repaint the pet previews'
  );
  // Every skin gets a swatch, and every swatch gets its colour from the pet's
  // own variables. A palette added to settings.js and nowhere else shows up here
  // as a circle the same colour as the window.
  const swatches = await sjs(`(() => [...document.querySelectorAll('.swatch')]
    .map((s) => getComputedStyle(s).backgroundColor))()`);
  check(
    swatches.length === require('../src/core/settings').SKINS.length,
    `${swatches.length} swatches for ${require('../src/core/settings').SKINS.length} skins`
  );
  check(new Set(swatches).size === swatches.length, `two skins share a swatch colour: ${swatches}`);
  for (const c of swatches) {
    check(/^rgba?\(/.test(c) && !c.startsWith('rgba(0, 0, 0, 0'), `a swatch has no colour (${c})`);
  }
  // And the wardrobe is offered in full, with something readable in each row.
  const wear = await sjs(`(() => [...document.getElementById('wear').options]
    .map((o) => [o.value, o.textContent]))()`);
  check(
    wear.length === require('../src/core/settings').WEAR.length,
    `${wear.length} outfits offered, ${require('../src/core/settings').WEAR.length} exist`
  );
  check(wear.every(([, label]) => label && label.trim()), 'an outfit has no label');

  check(
    (await sjs(`document.getElementById('vision-hint').classList.contains('warn')`)),
    'settings did not warn that no vision model is installed'
  );
  // Which recogniser hears you. Every engine settings.js accepts has to be
  // offerable, and the saved one has to come back selected - a control that
  // renders blank looks like the feature is off.
  const engines = await sjs(`(() => [...document.getElementById('dictation').options]
    .map((o) => o.value))()`);
  check(
    engines.join() === require('../src/core/settings').DICTATION.join(),
    `the recogniser choices are ${engines} but settings.js accepts ${require('../src/core/settings').DICTATION}`
  );
  check(
    (await sjs(`document.getElementById('dictation').value`)) === 'local',
    'the settings window did not preselect the saved recogniser'
  );
  // It is laid out in the flow, not in the fixed bottom bar. The first version
  // of this control used class="row" and landed on top of the save button.
  check(
    (await sjs(`getComputedStyle(document.getElementById('dictation')).position`)) === 'static',
    'the recogniser control is positioned out of the form flow'
  );
  // Greyed out with the microphone off, but it keeps its value - it is a
  // preference, not a permission.
  await sjs(`document.getElementById('mic').checked = false;
             document.getElementById('mic').dispatchEvent(new Event('change'))`);
  await settle();
  check(
    await sjs(`document.getElementById('dictation').disabled`),
    'the recogniser stayed live with the microphone switched off'
  );
  check(
    (await sjs(`document.getElementById('dictation').value`)) === 'local',
    'switching the microphone off forgot which recogniser was chosen'
  );
  await sjs(`document.getElementById('mic').checked = true;
             document.getElementById('mic').dispatchEvent(new Event('change'))`);
  await settle();
  check(
    await sjs(`document.getElementById('autostart').disabled`),
    'autostart was offered in an unpackaged build, where it would register electron.exe'
  );
  // A dependent setting has to visibly go with the one it needs, or the reason a
  // checkbox will not stick is only discoverable by saving and watching it revert.
  check(
    await sjs(`(() => {
      const memory = document.getElementById('memory');
      const cheek = document.getElementById('cheek');
      if (!memory.checked || cheek.disabled) return false;
      memory.checked = false;
      memory.dispatchEvent(new Event('change'));
      const gated = cheek.disabled && !cheek.checked;
      memory.checked = true;
      memory.dispatchEvent(new Event('change'));
      return gated && !cheek.disabled;
    })()`),
    'cheek did not follow the memory setting it depends on'
  );
  // The master switch. With it off the three networked settings must be
  // unreachable in the window as well as refused in the main process, and the
  // provider choice must sit on the local model.
  check(
    await sjs(`(() => {
      const net = document.getElementById('network');
      const boxes = ['weather', 'web'].map((id) => document.getElementById(id));
      const provider = document.getElementById('provider');
      const off = !net.checked && boxes.every((b) => b.disabled) && provider.disabled
        && provider.value === 'ollama';
      net.checked = true;
      net.dispatchEvent(new Event('change'));
      const on = boxes.every((b) => !b.disabled) && !provider.disabled;
      net.checked = false;
      net.dispatchEvent(new Event('change'));
      return off && on && boxes.every((b) => b.disabled);
    })()`),
    'the network switch did not gate the settings that need it'
  );
  // Choosing a company has to say so before you save, not after.
  check(
    await sjs(`(() => {
      const net = document.getElementById('network');
      const provider = document.getElementById('provider');
      net.checked = true; net.dispatchEvent(new Event('change'));
      provider.value = 'openai'; provider.dispatchEvent(new Event('change'));
      const hint = document.getElementById('provider-hint');
      const warned = hint.classList.contains('warn') && /sent to OpenAI/.test(hint.textContent);
      const keyable = !document.getElementById('api-key').disabled;
      provider.value = 'ollama'; provider.dispatchEvent(new Event('change'));
      net.checked = false; net.dispatchEvent(new Event('change'));
      return warned && keyable && !/sent to/.test(hint.textContent);
    })()`),
    'picking a hosted provider did not warn that the screen text goes to them'
  );
  // The key box is write-only. There is no channel that returns one, so there is
  // nothing here that could ever be populated from a stored key.
  check(
    await sjs(`typeof window.config.getKey === 'undefined'
      && typeof window.config.setKey === 'function'
      && document.getElementById('api-key').value === ''`),
    'the settings window has a way to read a stored API key'
  );
  // The window is not resizable, so anything below the fold is unreachable.
  check(
    await sjs(
      `document.getElementById('save').getBoundingClientRect().bottom <= window.innerHeight`
    ),
    'Save button falls outside the settings window - it is not resizable, so it cannot be reached'
  );
  fs.writeFileSync(path.join(ROOT, 'pet-settings.png'), (await sw.webContents.capturePage()).toPNG());

  // A malformed accelerator must not be savable - registering one throws.
  await sjs(
    `(() => { const h = document.getElementById('hotkey');
       h.value = 'Ctrl+'; h.dispatchEvent(new Event('input')); })()`
  );
  await settle();
  check(await sjs(`document.getElementById('save').disabled`), 'a bad hotkey was still savable');

  await sjs(
    `(() => { const h = document.getElementById('hotkey');
       h.value = 'Alt+Shift+P'; h.dispatchEvent(new Event('input'));
       document.querySelector('[data-skin="blossom"]').click();
       document.querySelector('#pets [data-pet="dragon"]').click();
       document.getElementById('wear').value = 'hero';
       document.getElementById('save').click(); })()`
  );
  await settle();
  check(saved !== null, 'Save sent nothing to the main process');
  check(saved && saved.hotkey === 'Alt+Shift+P', `hotkey not saved: ${saved && saved.hotkey}`);
  check(saved && saved.skin === 'blossom', `skin not saved: ${saved && saved.skin}`);
  check(saved && saved.pet === 'dragon', `pet not saved: ${saved && saved.pet}`);
  check(saved && saved.wear === 'hero', `outfit not saved: ${saved && saved.wear}`);

  // --- report -------------------------------------------------------------
  const all = [...errors, ...problems];
  if (all.length) {
    console.error('FAIL\n - ' + all.join('\n - '));
    return app.exit(1);
  }
  console.log(
    'ok - speech, chirps, noises, moods, expressions, gaze, species, skins, wardrobe, bars,\n'
    + '     hover, headpat, tickle, drag, chat, menu, settings and IPC all good.'
  );
  console.log(
    'wrote pet-preview.png, pet-hungry.png, pet-menu.png, pet-love.png, pet-chat.png,\n'
    + '      pet-faces.png, pet-species.png, pet-wardrobe.png, pet-settings.png'
  );
  app.exit(0);
});
