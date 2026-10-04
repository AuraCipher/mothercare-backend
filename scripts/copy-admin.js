/**
 * postbuild — copy the key-manager page into the compiled output.
 *
 * `tsc` only emits .js/.d.ts, so src/admin/index.html never reaches dist/.
 * Without this, `/key-manager` 404s on any fresh clone / CI build (it only
 * worked before because the file was copied by hand once).
 *
 * Wired up in package.json:  "postbuild": "node scripts/copy-admin.js"
 * npm runs it automatically after every `npm run build`.
 *
 * Plain Node, no deps → runs identically on Windows (dev) and Linux (VPS).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'admin', 'index.html');
const dest = path.join(root, 'dist', 'src', 'admin', 'index.html');

if (!fs.existsSync(src)) {
  console.error(`postbuild: missing ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`postbuild: src/admin/index.html -> dist/src/admin/index.html`);
