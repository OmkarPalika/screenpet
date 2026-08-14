// Generates build/license.txt - the page the NSIS installer shows before it
// installs anything - from TERMS.md, so the terms someone agrees to at install
// time cannot drift away from the terms in the repository. Run by `npm run
// dist` and `npm run pack`; the output is generated, not committed.
//
// NSIS reads the file into a rich edit control: it needs CRLF or the whole
// document runs together on one line, and a byte order mark or the two
// non-ASCII characters in TERMS.md (U+00B7 and an em dash) come out as
// mojibake. The mark is written escaped below because the character itself is
// invisible in an editor.

const fs = require('fs');
const path = require('path');

const BOM = '﻿';
const root = path.join(__dirname, '..');

const text = fs.readFileSync(path.join(root, 'TERMS.md'), 'utf8')
  .replace(/^#+ /gm, '')                          // headings
  .replace(/\*\*/g, '')                           // bold
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // links, keeping the target
  .replace(/\r?\n/g, '\r\n');

fs.writeFileSync(path.join(root, 'build', 'license.txt'), BOM + text, 'utf8');
