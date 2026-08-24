process.env.LOG_LEVEL='error';
import path from 'node:path';
import { connect, wipe, disconnect } from './tests/integration/setup.mjs';
await connect(); await wipe();
const ROOT = path.resolve('.');
const { default: app } = await import(`${ROOT}/app.js`);
const { User } = await import(`${ROOT}/src/models/User.js`);
const { Tenant } = await import(`${ROOT}/src/models/Tenant.js`);
const { ROLES } = await import(`${ROOT}/src/constants/enums.js`);
const { runInTenant, runUnscoped } = await import(`${ROOT}/src/utils/tenantContext.js`);

const tn = await runUnscoped('probe', async () => Tenant.create({name:'Probe',slug:'probe-x'}));
await runInTenant(tn._id, async () => {
  const a = new User({name:'A',email:'a@b.test',role:ROLES.ADMIN,isActive:true});
  await a.setPassword('IntegrationTest_2026!'); await a.save();
});
const s = app.listen(0);
await new Promise(r=>s.once('listening',r));
const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/login/admin`, {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({email:'a@b.test',password:'IntegrationTest_2026!'})});
console.log('STATUS', res.status);
console.log(JSON.stringify(await res.json(), null, 1).slice(0,700));
s.close(); await disconnect(); process.exit(0);
