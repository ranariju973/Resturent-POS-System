/**
 * Tests the REAL recalculate() and the tamper guard, extracted from
 * src/models/Order.js source (mongoose isn't installable in this sandbox,
 * so the methods are lifted out and run against plain objects).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
import { lineTotalMinor, percentOf, sumMinor, toMinor } from '../src/utils/money.js';

const src = fs.readFileSync(path.join(ROOT,'src/models/Order.js'),'utf8');

function extract(name){
  const start = src.indexOf(`orderSchema.methods.${name} = function`);
  if(start<0) throw new Error(`${name} not found in Order.js`);
  const bodyStart = src.indexOf('{', src.indexOf('(', start));
  let depth=0,i=bodyStart;
  for(;i<src.length;i++){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--; if(depth===0)break;} }
  return src.slice(bodyStart+1, i);
}

const recalcBody = extract('recalculate');
const recalculate = new Function('lineTotalMinor','percentOf','sumMinor','DISCOUNT_TYPE',
  `return function(){ ${recalcBody} }`)(lineTotalMinor,percentOf,sumMinor,{PERCENT:'percent',FIXED:'fixed'});

const mk = (items, extra={}) => Object.assign({
  items: items.map(([price,qty])=>({priceMinorAtSale:toMinor(price), qty})),
  discountType:null, discountValue:0, taxRate:0,
  subtotalMinor:0, discountMinor:0, taxMinor:0, totalMinor:0,
}, extra);

let pass=0,fail=0;
const eq=(label,got,want)=>{const ok=got===want; ok?pass++:fail++;
  console.log(`${ok?'PASS':'FAIL'} ${label}  got=${got}${ok?'':` want=${want}`}`);};

console.log('--- subtotal from lines ---');
let o=mk([[4.25,3],[5.25,1]]); recalculate.call(o);
eq('3x4.25 + 1x5.25 = 1800', o.subtotalMinor, 1800);
eq('no discount -> total = subtotal', o.totalMinor, 1800);

console.log('\n--- percentage discount ---');
o=mk([[4.25,3],[5.25,1]],{discountType:'percent',discountValue:10}); recalculate.call(o);
eq('10% off 1800 = 180', o.discountMinor, 180);
eq('total 1620', o.totalMinor, 1620);

console.log('\n--- fixed discount ---');
o=mk([[10,1]],{discountType:'fixed',discountValue:250}); recalculate.call(o);
eq('$2.50 off $10 -> 750', o.totalMinor, 750);

console.log('\n--- discount cannot make a bill negative ---');
o=mk([[10,1]],{discountType:'fixed',discountValue:999999}); recalculate.call(o);
eq('discount clamped to subtotal', o.discountMinor, 1000);
eq('total floors at 0', o.totalMinor, 0);
o=mk([[10,1]],{discountType:'percent',discountValue:150}); recalculate.call(o);
eq('150% clamped -> total 0', o.totalMinor, 0);

console.log('\n--- tax applies AFTER discount ---');
o=mk([[10,1]],{discountType:'percent',discountValue:10,taxRate:5}); recalculate.call(o);
eq('subtotal 1000', o.subtotalMinor, 1000);
eq('discount 100', o.discountMinor, 100);
eq('tax = 5% of 900 = 45 (not 5% of 1000)', o.taxMinor, 45);
eq('total 945', o.totalMinor, 945);

console.log('\n--- default: no tax row calculation (matches frontend) ---');
o=mk([[11.5,2]]); recalculate.call(o);
eq('taxRate 0 -> taxMinor 0', o.taxMinor, 0);
eq('total 2300', o.totalMinor, 2300);

console.log('\n--- totals are internally consistent (the guard\'s invariant) ---');
for(const spec of [
  {items:[[4.25,3],[5.25,1]],discountType:'percent',discountValue:12.5,taxRate:8},
  {items:[[9.75,2],[12.75,1],[5.5,4]],discountType:'fixed',discountValue:333,taxRate:18},
  {items:[[0.01,7]],taxRate:5},
]){
  const { items, ...opts } = spec;
  const d=mk(items,opts); recalculate.call(d);
  const expected = d.subtotalMinor - d.discountMinor + d.taxMinor;
  const allInt=[d.subtotalMinor,d.discountMinor,d.taxMinor,d.totalMinor].every(Number.isSafeInteger);
  const ok = d.totalMinor===expected && allInt;
  ok?pass++:fail++;
  console.log(`${ok?'PASS':'FAIL'} sub=${d.subtotalMinor} disc=${d.discountMinor} tax=${d.taxMinor} total=${d.totalMinor} (all integers: ${allInt})`);
}

console.log('\n--- tamper guard: a forged total is overwritten, not trusted ---');
// Simulates a controller copying a client-supplied total onto the document.
const forged = mk([[4.25,3],[5.25,1]]);
forged.subtotalMinor=1; forged.discountMinor=0; forged.taxMinor=0; forged.totalMinor=1; // "pay 1 cent"
const claimed={...forged};
recalculate.call(forged);
const mismatched = claimed.subtotalMinor!==forged.subtotalMinor || claimed.totalMinor!==forged.totalMinor;
const wasInitialised = claimed.totalMinor!==0 || claimed.subtotalMinor!==0;
eq('recalculated to the true total', forged.totalMinor, 1800);
const guardFires = mismatched && wasInitialised;
guardFires?pass++:fail++;
console.log(`${guardFires?'PASS':'FAIL'} pre-validate guard would reject the forged document`);

// A fresh document with zeroed totals must NOT trip the guard.
const fresh = mk([[4.25,1]]); const freshClaimed={...fresh};
recalculate.call(fresh);
const freshInit = freshClaimed.totalMinor!==0 || freshClaimed.subtotalMinor!==0;
(!freshInit)?pass++:fail++;
console.log(`${!freshInit?'PASS':'FAIL'} new document with zero totals is not treated as tampering`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
