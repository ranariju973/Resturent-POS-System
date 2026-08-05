/**
 * Keeps the frontend's permission strings in sync with the backend's.
 *
 * The two files are separate on purpose — the frontend cannot import from the
 * backend's source tree — but a typo or a rename on one side would silently
 * desync them. The symptom is nasty and confusing: a nav entry that renders
 * fine and then 403s, or worse, one that stays hidden from a role that should
 * see it, which looks like a permissions bug rather than a typo.
 *
 * This reads both files and compares. It is skipped, not failed, when the
 * frontend is not checked out alongside the backend.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_VALUES } from '../src/constants/permissions.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * The frontend directory has been called both of these. Resolving either is
 * not tidiness: this test SKIPS when it cannot find the client, so a rename
 * silently switches the whole parity guarantee off rather than failing loudly.
 * Trying both names means that cannot happen twice.
 */
const CLIENT_CANDIDATES = ['../Frontend', '../Resturent-POS-System-Frontend'].map((dir) =>
  path.resolve(ROOT, `${dir}/src/lib/permissions.ts`),
);
const CLIENT = CLIENT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? CLIENT_CANDIDATES[0];

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

if (!fs.existsSync(CLIENT)) {
  console.log('SKIP frontend not present at ../Frontend — nothing to compare');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const src = fs.readFileSync(CLIENT, 'utf8');

// Pull the string literals out of the PERMISSIONS object literal.
const block = src.slice(src.indexOf('export const PERMISSIONS'), src.indexOf('} as const;'));
const clientPerms = [...block.matchAll(/:\s*'([a-z_]+:[a-z_:]+)'/g)].map((m) => m[1]);

console.log('--- permission strings ---');
console.log(`     backend:  ${PERMISSION_VALUES.length}`);
console.log(`     frontend: ${clientPerms.length}`);

const serverSet = new Set(PERMISSION_VALUES);
const clientSet = new Set(clientPerms);

const onlyServer = PERMISSION_VALUES.filter((p) => !clientSet.has(p));
const onlyClient = clientPerms.filter((p) => !serverSet.has(p));

t('no permission exists only on the backend', onlyServer.length === 0, onlyServer.join(', '));
t('no permission exists only on the frontend', onlyClient.length === 0, onlyClient.join(', '));
t('counts match', PERMISSION_VALUES.length === clientPerms.length);
t('frontend has no duplicates', clientSet.size === clientPerms.length);

console.log('\n--- screen guards reference real permissions ---');
const screenBlock = src.slice(
  src.indexOf('SCREEN_PERMISSION'),
  src.indexOf('export function can('),
);
const referenced = [...screenBlock.matchAll(/PERMISSIONS\.([A-Z_]+)/g)].map((m) => m[1]);
const clientKeys = new Set([...block.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]));
const dangling = referenced.filter((k) => !clientKeys.has(k));
t(`all ${referenced.length} screen guards resolve to a defined key`, dangling.length === 0,
  dangling.join(', '));

console.log('\n--- every screen is guarded ---');
const SCREENS = [
  'dashboard', 'billing', 'menu', 'tables', 'kitchen', 'customers', 'reports', 'employees',
];
const guarded = SCREENS.filter((s) => new RegExp(`^\\s*${s}:`, 'm').test(screenBlock));
t(`${SCREENS.length} screens declared, ${guarded.length} guarded`, guarded.length === SCREENS.length,
  SCREENS.filter((s) => !guarded.includes(s)).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
