import { TABLE_TRANSITIONS, TABLE_STATUS_VALUES, NEXT_TICKET_STATUS, TICKET_STATUS,
         TICKET_STATUS_VALUES, ROLE_VALUES, PIN_ROLES, ROLES } from '../src/constants/enums.js';
let pass=0,fail=0;
const t=(label,ok)=>{ ok?pass++:fail++; console.log(`${ok?'PASS':'FAIL'} ${label}`); };

console.log('--- ticket board is forward-only, one step ---');
// Walk the whole chain and confirm it terminates at served.
let s=TICKET_STATUS.PENDING, chain=[s], guard=0;
while(NEXT_TICKET_STATUS[s] && guard++<10){ s=NEXT_TICKET_STATUS[s]; chain.push(s); }
t(`chain = ${chain.join(' -> ')}`, chain.join()==='pending,preparing,ready,served');
t('served is terminal', NEXT_TICKET_STATUS[TICKET_STATUS.SERVED]===null);
t('every status has a defined next (no undefined)', TICKET_STATUS_VALUES.every(v=>v in NEXT_TICKET_STATUS));
t('no status advances to itself', TICKET_STATUS_VALUES.every(v=>NEXT_TICKET_STATUS[v]!==v));
// The skip a client would attempt:
t('pending cannot reach served in one step', NEXT_TICKET_STATUS[TICKET_STATUS.PENDING]!=='served');

console.log('\n--- table transitions ---');
t('every status is a transition key', TABLE_STATUS_VALUES.every(v=>v in TABLE_TRANSITIONS));
t('every target is a real status', Object.values(TABLE_TRANSITIONS).flat().every(v=>TABLE_STATUS_VALUES.includes(v)));
t('occupied -> available only (must settle, not jump to reserved)',
  JSON.stringify(TABLE_TRANSITIONS.occupied)===JSON.stringify(['available']));
t('available -> occupied allowed', TABLE_TRANSITIONS.available.includes('occupied'));
t('no self-transitions listed', Object.entries(TABLE_TRANSITIONS).every(([k,v])=>!v.includes(k)));

console.log('\n--- roles ---');
t('three roles', ROLE_VALUES.length===3);
t('all snake_case/lowercase', ROLE_VALUES.every(r=>/^[a-z_]+$/.test(r)));
t('admin is NOT a PIN role (email+password only)', !PIN_ROLES.includes(ROLES.ADMIN));
t('cashier + kitchen_staff are PIN roles', PIN_ROLES.length===2 && PIN_ROLES.includes('cashier') && PIN_ROLES.includes('kitchen_staff'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
