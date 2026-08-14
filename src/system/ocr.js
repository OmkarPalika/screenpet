'use strict';

const host = require('./host');

// Which engine reads the screen is host.js's problem: Windows.Media.Ocr through
// ocr.ps1, or Vision through the macOS helper. Both take a base64 PNG on stdin
// and print the same fragment JSON, so everything below this line is one code
// path rather than two.

/**
 * Windows OCR reports where every fragment sits but not what order to read them
 * in, and its own ordering interleaves rows on anything laid out in columns -
 * code, nav bars, tables. Rebuild reading order from the boxes: fragments whose
 * vertical centres overlap are one row, rows top to bottom, fragments left to
 * right within a row.
 *
 * @param {Array<{top:number,bottom:number,left:number,text:string}>} frags
 * @returns {string}
 */
function toReadingOrder(frags) {
  const rows = [];
  for (const f of [...frags].sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom))) {
    const centre = (f.top + f.bottom) / 2;
    const row = rows[rows.length - 1];
    // Slack comes from the row's own height, so big headings and small print
    // each group by their own scale rather than a pixel constant.
    if (row && Math.abs(centre - row.centre) <= row.slack) row.frags.push(f);
    else rows.push({ centre, slack: Math.max((f.bottom - f.top) * 0.6, 1), frags: [f] });
  }
  return rows
    .map((r) => r.frags.sort((a, b) => a.left - b.left).map((f) => f.text).join(' '))
    .join('\n');
}

/**
 * @param {Buffer} pngBuffer  PNG bytes, passed on stdin. Never written to disk.
 * @returns {Promise<string>} recognised text, in reading order
 */
function recognise(pngBuffer) {
  return new Promise((resolve, reject) => {
    const ps = host.spawn('ocr');

    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `OCR exited with code ${code}`));
      try {
        resolve(toReadingOrder(JSON.parse(out || '[]')));
      } catch (e) {
        reject(new Error(`OCR returned unreadable output: ${e.message}`));
      }
    });

    ps.stdin.end(pngBuffer.toString('base64'));
  });
}

module.exports = { recognise, toReadingOrder };
