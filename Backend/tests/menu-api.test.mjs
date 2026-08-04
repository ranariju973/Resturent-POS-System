/**
 * Menu API — Phase 5.
 *
 * ── Coverage boundary, stated plainly ──────────────────────────────────────
 * No MongoDB is available in this environment, so the CRUD paths themselves
 * (create, update, delete, the Cloudinary round trip) are NOT exercised here.
 * What is exercised, for real:
 *
 *   • the auth wall on every route, over live HTTP
 *   • the actual zod schemas, imported and run
 *   • the actual magic-byte detector, run on real file signatures
 *   • a static audit that every route names a permission
 *
 * The gap — that a valid admin request genuinely creates the right document
 * and cleans up its Cloudinary asset on failure — needs a database and belongs
 * in the Phase 12 integration tests. It is a real gap, not a covered one.
 */
process.env.NODE_ENV = 'development';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/verdant_pos_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.PIN_PEPPER = 'c'.repeat(64);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import path from 'node:path';
import {
  createItemSchema,
  updateItemSchema,
  availabilitySchema,
  listItemsSchema,
  createCategorySchema,
} from '../src/validators/menu.js';
import { detectImageFormat } from '../src/middleware/upload.js';

const { default: app } = await import('../app.js');

// A throw at top level was ending the run with exit 0 and no message, which
// silently truncated the suite. Make any escape loud.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (err) => {
    console.error(`\n!! ${signal}: ${err?.stack ?? err}`);
    process.exit(1);
  });
}

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

const ok = (schema, input) => schema.safeParse(input).success;
const errOf = (schema, input) => {
  const r = schema.safeParse(input);
  return r.success ? null : r.error.issues[0]?.message;
};

// ---------------------------------------------------------------------------
console.log('--- price: major units in, minor units out ---');
const base = { name: 'Cold Brew', category: '507f1f77bcf86cd799439011' };

{
  const parsed = createItemSchema.parse({ ...base, price: 4.25 });
  t('4.25 becomes priceMinor 425', parsed.priceMinor === 425, `got ${parsed.priceMinor}`);
  t('the ambiguous `price` key is gone from the parsed body', !('price' in parsed));
}
{
  const parsed = createItemSchema.parse({ ...base, price: '11.50' });
  t('multipart string "11.50" becomes 1150', parsed.priceMinor === 1150);
}
{
  const parsed = createItemSchema.parse({ ...base, price: '9' });
  t('whole number "9" becomes 900', parsed.priceMinor === 900);
}
{
  const parsed = createItemSchema.parse({ ...base, price: 0.07 });
  t('0.07 becomes 7 with no float drift', parsed.priceMinor === 7);
}

console.log('\n--- price: what is refused ---');
t('three decimals rejected', !ok(createItemSchema, { ...base, price: '4.255' }),
  errOf(createItemSchema, { ...base, price: '4.255' }));
t('zero rejected', !ok(createItemSchema, { ...base, price: 0 }));
t('negative rejected', !ok(createItemSchema, { ...base, price: -5 }));
t('non-numeric rejected', !ok(createItemSchema, { ...base, price: 'free' }));
t('implausibly large rejected', !ok(createItemSchema, { ...base, price: 999999 }));
t('scientific notation rejected', !ok(createItemSchema, { ...base, price: '1e3' }));
t('leading-plus rejected', !ok(createItemSchema, { ...base, price: '+4.25' }));
t('whitespace-padded value still parses', ok(createItemSchema, { ...base, price: ' 4.25 ' }));
t('missing price rejected', !ok(createItemSchema, { ...base }));

console.log('\n--- create: unknown keys are refused, not stripped ---');
t('priceMinor cannot be supplied directly',
  !ok(createItemSchema, { ...base, price: 4.25, priceMinor: 1 }));
t('isActive cannot be set on create',
  !ok(createItemSchema, { ...base, price: 4.25, isActive: false }));
t('imageUrl cannot be injected (bypassing Cloudinary)',
  !ok(createItemSchema, { ...base, price: 4.25, imageUrl: 'https://evil.example/x.jpg' }));
t('imagePublicId cannot be injected',
  !ok(createItemSchema, { ...base, price: 4.25, imagePublicId: 'someone-elses-asset' }));
t('invalid category id rejected', !ok(createItemSchema, { ...base, price: 4.25, category: 'nope' }));
t('name under 2 chars rejected', !ok(createItemSchema, { ...base, price: 4.25, name: 'x' }));
t('name over 80 chars rejected', !ok(createItemSchema, { ...base, price: 4.25, name: 'x'.repeat(81) }));

console.log('\n--- multipart booleans ---');
t("available:'true' becomes true", createItemSchema.parse({ ...base, price: 1, available: 'true' }).available === true);
t("available:'false' becomes false", createItemSchema.parse({ ...base, price: 1, available: 'false' }).available === false);
t('available defaults to true', createItemSchema.parse({ ...base, price: 1 }).available === true);
t("available:'maybe' rejected", !ok(createItemSchema, { ...base, price: 1, available: 'maybe' }));

console.log('\n--- the availability toggle is deliberately narrow ---');
t('accepts { available: true }', ok(availabilitySchema, { available: true }));
t('accepts { available: false }', ok(availabilitySchema, { available: false }));
t('REJECTS a price smuggled alongside', !ok(availabilitySchema, { available: false, price: 1 }));
t('REJECTS a category change alongside',
  !ok(availabilitySchema, { available: true, category: '507f1f77bcf86cd799439011' }));
t('REJECTS name alongside', !ok(availabilitySchema, { available: true, name: 'Free Coffee' }));
t('REJECTS isActive alongside', !ok(availabilitySchema, { available: true, isActive: false }));
t('rejects a string "true" (this endpoint is JSON, not multipart)',
  !ok(availabilitySchema, { available: 'true' }));
t('rejects an empty body', !ok(availabilitySchema, {}));

console.log('\n--- update ---');
t('a single field is enough', ok(updateItemSchema, { name: 'New Name' }));
t('empty update rejected', !ok(updateItemSchema, {}));
t('price omitted leaves priceMinor absent',
  !('priceMinor' in updateItemSchema.parse({ name: 'Iced Matcha' })));
t('removeImage stays absent when not sent (so it cannot fake a non-empty update)',
  !('removeImage' in updateItemSchema.parse({ name: 'Iced Matcha' })));
t('price present converts', updateItemSchema.parse({ price: '3.50' }).priceMinor === 350);
t('removeImage accepted', ok(updateItemSchema, { removeImage: true }));
t('unknown key rejected', !ok(updateItemSchema, { name: 'Iced Matcha', sneaky: 1 }));

console.log('\n--- list filters are bounded ---');
t('limit defaults to 200', listItemsSchema.parse({}).limit === 200);
t('limit above 200 rejected', !ok(listItemsSchema, { limit: 5000 }));
t('limit of 0 rejected', !ok(listItemsSchema, { limit: 0 }));
t('search capped at 80 chars', !ok(listItemsSchema, { search: 'x'.repeat(81) }));
t('unknown filter rejected', !ok(listItemsSchema, { sortBy: 'price' }));
t('bad category id rejected', !ok(listItemsSchema, { category: 'nope' }));

console.log('\n--- category ---');
t('valid category accepted', ok(createCategorySchema, { name: 'Pizza', color: '#00754A' }));
t('color defaults', createCategorySchema.parse({ name: 'Pizza' }).color === '#00754A');
t('3-digit hex rejected', !ok(createCategorySchema, { name: 'Pizza', color: '#fff' }));
t('named colour rejected', !ok(createCategorySchema, { name: 'Pizza', color: 'red' }));
t('css injection in colour rejected',
  !ok(createCategorySchema, { name: 'Pizza', color: '#000;background:url(x)' }));

// ---------------------------------------------------------------------------
console.log('\n--- image detection runs on real signatures ---');
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20),
]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(20),
]);

t('JPEG detected', detectImageFormat(jpeg) === 'jpeg');
t('PNG detected', detectImageFormat(png) === 'png');
t('WebP detected', detectImageFormat(webp) === 'webp');

console.log('\n--- content sniffing catches what MIME headers cannot ---');
// The whole point: these all arrive claiming to be image/jpeg.
const phpShell = Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(40));
const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(20)]);
const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(40));
const svg = Buffer.from('<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>'.padEnd(40));
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7', 'ascii'), Buffer.alloc(20)]);

t('PHP shell rejected', detectImageFormat(phpShell) === null);
t('ELF binary rejected', detectImageFormat(elf) === null);
t('HTML rejected', detectImageFormat(html) === null);
t('SVG rejected (scriptable, so not an accepted image format)', detectImageFormat(svg) === null);
t('ZIP rejected', detectImageFormat(zip) === null);
t('PDF rejected', detectImageFormat(pdf) === null);
t('empty buffer rejected', detectImageFormat(Buffer.alloc(0)) === null);
t('truncated buffer rejected', detectImageFormat(Buffer.from([0xff, 0xd8])) === null);
t('non-buffer rejected', detectImageFormat('ffd8ff') === null);

// A RIFF container that is NOT WebP — the reason the detector checks bytes 8-11.
const wav = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE', 'ascii'),
  Buffer.alloc(20),
]);
t('RIFF/WAVE rejected (RIFF prefix alone is not enough)', detectImageFormat(wav) === null);

// A JPEG header glued in front of a payload still reads as a JPEG — worth
// being explicit that signature checking is not content scanning.
const polyglot = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), phpShell]);
t('polyglot with a real JPEG header IS accepted (documented limitation)',
  detectImageFormat(polyglot) === 'jpeg');

// ---------------------------------------------------------------------------
console.log('\n--- every menu route is behind authentication (live HTTP) ---');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const ROUTES = [
  ['GET', '/api/menu/items'],
  ['GET', '/api/menu/items/507f1f77bcf86cd799439011'],
  ['POST', '/api/menu/items'],
  ['PUT', '/api/menu/items/507f1f77bcf86cd799439011'],
  ['DELETE', '/api/menu/items/507f1f77bcf86cd799439011'],
  ['PATCH', '/api/menu/items/507f1f77bcf86cd799439011/availability'],
  ['GET', '/api/menu/categories'],
  ['POST', '/api/menu/categories'],
  ['PUT', '/api/menu/categories/507f1f77bcf86cd799439011'],
  ['DELETE', '/api/menu/categories/507f1f77bcf86cd799439011'],
];

try {
  let unauthorised = 0;
  for (const [method, url] of ROUTES) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
    });
    if (res.status === 401) unauthorised += 1;
    else console.log(`     ${method} ${url} -> ${res.status} (expected 401)`);
  }
  t(`all ${ROUTES.length} routes reject an anonymous caller with 401`,
    unauthorised === ROUTES.length, `${unauthorised}/${ROUTES.length}`);

  // A forged token must not get further than no token at all.
  const forged = await fetch(`${baseUrl}/api/menu/items`, {
    headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0.' },
  });
  t('alg:none token forging an admin role is rejected', forged.status === 401);

  const garbage = await fetch(`${baseUrl}/api/menu/items`, {
    headers: { Authorization: 'Bearer not-a-token' },
  });
  t('malformed bearer token rejected', garbage.status === 401);

  const noScheme = await fetch(`${baseUrl}/api/menu/items`, {
    headers: { Authorization: 'eyJhbGciOiJIUzI1NiJ9.e30.x' },
  });
  t('token without the Bearer scheme rejected', noScheme.status === 401);
} finally {
  await new Promise((r) => server.close(r));
}

// ---------------------------------------------------------------------------
console.log('\n--- route wiring audit ---');
const ROOT = path.resolve(import.meta.dirname, '..');
const routeSrc = fs.readFileSync(path.join(ROOT, 'src/routes/menu.js'), 'utf8');

const declarations = [...routeSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
t(`${declarations.length} routes declared`, declarations.length === 10, `${declarations.length}`);

// Each router.X( ... ) block should name a permission.
const blocks = routeSrc.split(/router\.(?=get|post|put|patch|delete)/).slice(1);
const missingPermission = blocks
  .map((b) => ({ block: b, first: b.slice(0, b.indexOf(')')) }))
  .filter((b) => !b.block.slice(0, b.block.indexOf('\n);')).includes('requirePermission'));
t('every route names a permission', missingPermission.length === 0,
  missingPermission.map((b) => b.first).join(', '));

t('requireAuth applied to the whole router', /router\.use\(requireAuth\(\)\)/.test(routeSrc));
t('availability route declared before /items/:id (specific path wins)',
  routeSrc.indexOf("'/items/:id/availability'") < routeSrc.indexOf("'/items/:id'"));
t('upload routes verify content after multer',
  /uploadImage\('image'\),\s*\n\s*verifyImageContent/.test(routeSrc));
t('both upload routes are admin-only',
  (routeSrc.match(/MENU_CREATE|MENU_EDIT/g) ?? []).length >= 4);
t('stock toggle uses MENU_TOGGLE_STOCK', /MENU_TOGGLE_STOCK/.test(routeSrc));

const ctlSrc = fs.readFileSync(path.join(ROOT, 'src/controllers/menuController.js'), 'utf8');
t('orphaned uploads are cleaned up on a failed save',
  /catch \(err\) \{[\s\S]{0,200}discardUpload/.test(ctlSrc));
t('the replaced image is deleted only AFTER a successful save',
  ctlSrc.indexOf('await item.save()') < ctlSrc.indexOf("'image-replaced'"));
t('search term is regex-escaped', /escapeRegex\(search\)/.test(ctlSrc));
t('soft delete keeps the document for order history', /softDelete\(\)/.test(ctlSrc));
t('price changes are audited', /MENU_ITEM_PRICE_CHANGE/.test(ctlSrc));
t('availability handler assigns one field, not the body',
  /item\.available = available;/.test(ctlSrc) && !/Object\.assign\(item, req\.body\)/.test(ctlSrc));

const catSrc = fs.readFileSync(path.join(ROOT, 'src/controllers/categoryController.js'), 'utf8');
t('category delete refuses while items reference it', /itemCount > 0/.test(catSrc));
t('category counts use one aggregation, not a query per row', /aggregate\(/.test(catSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
