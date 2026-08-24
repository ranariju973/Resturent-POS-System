/**
 * Keeps the client's route parameters ID-shaped.
 *
 * ── The bug this exists to prevent ─────────────────────────────────────────
 * The category delete button passed `cat.name` where every consumer expected
 * `cat.id`. The name went straight into the URL — DELETE /api/menu/categories/
 * Beverages — and the route's ObjectId schema rejected it, so an admin trying
 * to delete a category got a bare "Validation failed" toast. The request never
 * reached Mongoose, which is why nothing in the backend suites caught it.
 *
 * The item button on the same screen passed `item.id` correctly, so only
 * categories failed. That asymmetry is the tell: this is a contract between
 * two files that no type checker enforces, because both sides are `string`.
 *
 * ── Why a source-text test and not a unit test ─────────────────────────────
 * The failing edge is one argument at one call site. A unit test would have to
 * mount the screen, stub the store and assert on a fetch URL — a great deal of
 * machinery to observe a single identifier. Reading the source is what the
 * sibling suites (menu-api, client-permission-parity) already do for exactly
 * this kind of cross-file contract.
 *
 * Skipped, not failed, when the frontend is not checked out alongside — the
 * same rule client-permission-parity.test.mjs follows.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Both names this directory has had. Resolving either is not tidiness: this
 * suite SKIPS when it cannot find the client, so a rename would silently
 * switch the guarantee off rather than failing loudly.
 */
const CLIENT_CANDIDATES = ['../Frontend', '../Resturent-POS-System-Frontend'].map((dir) =>
  path.resolve(ROOT, dir),
);
const CLIENT = CLIENT_CANDIDATES.find((c) => fs.existsSync(path.join(c, 'src'))) ?? null;

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

if (!CLIENT) {
  console.log('SKIP frontend not present at ../Frontend — nothing to compare');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const read = (rel) => fs.readFileSync(path.join(CLIENT, rel), 'utf8');

// --- the specific regression -------------------------------------------------
const menuScreen = read('src/screens/MenuManagement.tsx');

const deleteCalls = [...menuScreen.matchAll(/openDeleteModal\(\s*'(cat|item)'\s*,\s*([^)]+?)\s*\)/g)];

t('both delete buttons are present on the menu screen', deleteCalls.length === 2,
  `found ${deleteCalls.length}`);

for (const [, kind, arg] of deleteCalls) {
  // `.id` is the only acceptable shape. `.name` is the bug; anything else is
  // unreviewed and should be looked at deliberately.
  t(`openDeleteModal('${kind}', …) passes an id, not a name`, /\.id$/.test(arg.trim()),
    `got: ${arg.trim()}`);
}

// --- the general rule --------------------------------------------------------
/*
 * Every menuApi call that interpolates into a path takes an id. Asserting the
 * PARAMETER NAME is deliberate: it is the one place the intent is written down
 * where both a human and this regex can see it, and a future
 * `deleteCategory(name)` would be caught here even if the call site looked
 * plausible.
 */
const menuApi = read('src/lib/menuApi.ts');
const pathFns = [...menuApi.matchAll(
  /export async function (\w+)\(\s*(\w+)[^)]*\)[\s\S]{0,200}?`\/api\/[^`]*\$\{(\w+)\}/g,
)];

t('menuApi has path-parameterised functions to check', pathFns.length > 0,
  `found ${pathFns.length}`);

for (const [, fnName, firstParam, interpolated] of pathFns) {
  t(`menuApi.${fnName} interpolates its first parameter`, firstParam === interpolated,
    `signature (${firstParam}) vs path \${${interpolated}}`);
  t(`menuApi.${fnName} names that parameter 'id'`, /^id$/i.test(interpolated),
    `got: ${interpolated}`);
}

// --- the copy matches what the server actually does --------------------------
/*
 * The modal used to promise "the category and every item inside it" will be
 * removed. The server does the opposite — assertCategoryEmpty refuses with a
 * 409 while items remain. Misleading destructive copy is its own defect: it
 * tells an admin their items are about to be deleted when they are not.
 */
const modals = read('src/components/menuModals.tsx');
t('the delete modal does not promise a cascade the server refuses',
  !/category and every item inside it/i.test(modals));

const guard = fs.readFileSync(path.join(ROOT, 'src/utils/referenceGuard.js'), 'utf8');
t('assertCategoryEmpty still refuses a non-empty category (the copy depends on it)',
  /assertCategoryEmpty/.test(guard) && /conflict|409/i.test(guard));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
