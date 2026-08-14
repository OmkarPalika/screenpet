'use strict';

// What this machine can actually do, in one screen. Run it first on a host the
// app has not been tried on before - the alternative is finding out one feature
// at a time, each as a sentence in a speech bubble.
//
// Run: npm run doctor

const os = require('os');
const fs = require('fs');
const http = require('http');
const host = require('../src/system/host');

const tick = (ok) => (ok ? 'yes' : 'no ');

console.log(`screenpet doctor - ${process.platform} ${os.release()} (${process.arch})`);
console.log(`node ${process.version}\n`);

console.log('capability      host  ready  note');
console.log('--------------  ----  -----  ----');
let missing = 0;
for (const cap of host.report()) {
  const note = cap.ready ? '' : cap.why;
  if (!cap.ready) missing += 1;
  console.log(
    `${cap.name.padEnd(14)}  ${tick(cap.supported)}   ${tick(cap.ready)}    ${note}`
  );
}

// The two things that are a download rather than a platform feature, so their
// absence is a thing to go and fix rather than a thing to live with.
console.log('');
if (host.PLATFORM === 'darwin') {
  console.log(`helper binary   ${tick(fs.existsSync(host.HELPER))}          ${host.HELPER}`);
  if (!fs.existsSync(host.HELPER)) console.log('                       build it with: npm run build:helper');
}

const reachable = (url) => new Promise((resolve) => {
  const req = http.get(url, (res) => {
    res.resume();
    resolve(res.statusCode === 200);
  });
  req.on('error', () => resolve(false));
  req.setTimeout(1500, () => { req.destroy(); resolve(false); });
});

(async () => {
  const ollama = await reachable('http://127.0.0.1:11434/api/tags');
  console.log(`ollama          ${tick(ollama)}          http://127.0.0.1:11434`);
  if (!ollama) console.log('                       not answering - the pet cannot think without it');

  console.log('');
  const problems = missing + (ollama ? 0 : 1);
  if (problems === 0) {
    console.log('everything this app needs is here.');
  } else {
    if (missing) console.log(`${missing} capability(s) this host does not have; the pet says so when asked.`);
    if (!ollama) console.log('ollama is not running, which stops the pet answering anything at all.');
  }
  process.exitCode = problems ? 1 : 0;
})();
