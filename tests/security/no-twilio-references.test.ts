/**
 * M22 §49 — Twilio-zero repository gate.
 *
 * Fails if any ACTIVE source, config, doc, or script references Twilio or the
 * removed automated-WhatsApp pipeline. Ignored only:
 *  - historical migration reports under execution/ (intentional records),
 *  - test files themselves (may describe the guarantee),
 *  - node_modules / build output / lockfiles' transitive content.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_DIRS = ['backend/src', 'backend/scripts', 'web/src', 'mobile'];

const BANNED = [
  /twilio/i,
  /api\.twilio\.com/,
  /ContentSid/,
  /ContentVariables/,
  /Messages\.json/,
  /sendTemplateMessage/,
  /enqueueCredentialSend/,
  /deliverCredential/,
  /send-credentials/,
  /send-all-credentials/,
  /credential_send/,
  /HX[0-9a-f]{32}/,
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'execution']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && !SKIP_FILES.has(e.name) && !/\.test\.(ts|tsx|js)$/.test(e.name)) yield full;
  }
}

describe('M22 — Twilio-zero repository gate', () => {
  test('no active source/config/doc references Twilio or the automated pipeline', () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        // Binary guard: skip files with null bytes.
        if (content.includes('\0')) continue;
        for (const pattern of BANNED) {
          if (pattern.test(content)) {
            violations.push(`${path.relative(ROOT, file)} :: ${pattern}`);
            break;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no twilio dependency in backend package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((k) => /twilio/i.test(k))).toEqual([]);
  });

  test('no TWILIO_* keys in env schema or examples', () => {
    for (const file of ['backend/src/config/env.ts', 'backend/.env.example', '.env.production', 'backend/.env.docker']) {
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) continue;
      expect(fs.readFileSync(full, 'utf8')).not.toMatch(/TWILIO_/);
    }
  });
});
