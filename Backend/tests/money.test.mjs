// Real import — money.js has no third-party dependencies.
import { toMinor, toMajor, percentOf, sumMinor, lineTotalMinor, splitMinor, isValidMinor }
  from '../src/utils/money.js';

let pass=0, fail=0;
const eq=(label,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  ok?pass++:fail++; console.log(`${ok?'PASS':'FAIL'} ${label}  got=${JSON.stringify(got)}${ok?'':` want=${JSON.stringify(want)}`}`); };
const throws=(label,fn)=>{ try{fn(); fail++; console.log(`FAIL ${label} (expected throw)`);}catch{pass++;console.log(`PASS ${label} rejects`);} };

console.log('--- float trap the integer convention exists to avoid ---');
console.log(`     naive float: 4.25*3 + 5.25 = ${4.25*3+5.25}`);
console.log(`     0.1 + 0.2 = ${0.1+0.2}  (!== 0.3)`);

console.log('\n--- conversion ---');
eq('toMinor(4.25)', toMinor(4.25), 425);
eq('toMinor(1840.50)', toMinor(1840.50), 184050);
eq('toMinor("10.00")', toMinor('10.00'), 1000);
eq('toMinor(0.07) no float drift', toMinor(0.07), 7);
eq('toMinor(11.5)', toMinor(11.5), 1150);
eq('toMajor(425)', toMajor(425), 4.25);
eq('round-trips all seed prices', [4.25,4.75,5.25,10,8.5,5.5,6.25,9.75,9,11.5,12.75].map(p=>toMajor(toMinor(p))), [4.25,4.75,5.25,10,8.5,5.5,6.25,9.75,9,11.5,12.75]);

console.log('\n--- line totals & sums (exact) ---');
eq('3 x $4.25', lineTotalMinor(425,3), 1275);
eq('cart 3x4.25 + 1x5.25', sumMinor([lineTotalMinor(425,3), lineTotalMinor(525,1)]), 1800);
eq('1000 x $0.01 sums exactly', sumMinor(Array(1000).fill(1)), 1000);
throws('qty 0 rejected', ()=>lineTotalMinor(425,0));
throws('fractional qty rejected', ()=>lineTotalMinor(425,1.5));
throws('negative price rejected', ()=>lineTotalMinor(-1,1));

console.log('\n--- percentages (single rounding point) ---');
eq('10% of 1800', percentOf(1800,10), 180);
eq('12.5% of 1275 rounds half-up', percentOf(1275,12.5), 159);
eq('0% is zero', percentOf(1800,0), 0);
eq('100% is whole', percentOf(1800,100), 1800);
throws('negative percent rejected', ()=>percentOf(1800,-5));

console.log('\n--- split-bill conserves every cent ---');
for (const [amt,ways] of [[1000,3],[1275,4],[1,3],[184050,7],[999,999]]) {
  const parts=splitMinor(amt,ways); const total=sumMinor(parts);
  const ok = total===amt && parts.length===ways && Math.max(...parts)-Math.min(...parts)<=1;
  ok?pass++:fail++;
  console.log(`${ok?'PASS':'FAIL'} split ${amt} / ${ways} -> sum ${total}${ways<=4?` ${JSON.stringify(parts)}`:''}`);
}
throws('split 0 ways rejected', ()=>splitMinor(1000,0));

console.log('\n--- guard ---');
eq('isValidMinor(425)', isValidMinor(425), true);
eq('isValidMinor(4.25) false', isValidMinor(4.25), false);
eq('isValidMinor(-1) false', isValidMinor(-1), false);
eq('isValidMinor(NaN) false', isValidMinor(NaN), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
