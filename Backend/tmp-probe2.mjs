process.env.LOG_LEVEL='error';
import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import './src/models/index.js';
import { User } from './src/models/User.js';
import { Tenant } from './src/models/Tenant.js';
import { ROLES } from './src/constants/enums.js';
import { runInTenant, runUnscoped } from './src/utils/tenantContext.js';
await mongoose.connect(env.MONGO_URI.replace('restaurant_pos_dev','probe_db'));
await mongoose.connection.db.dropDatabase();
const tn = await runUnscoped('probe', async () => Tenant.create({name:'Probe',slug:'probe-x'}));
await runInTenant(tn._id, async () => {
  const a = new User({name:'A',email:'a@b.test',role:ROLES.ADMIN,isActive:true});
  await a.setPassword('IntegrationTest_2026!'); await a.save();
});
// the exact call loginAdmin makes, with NO tenant context (as a login has none)
try {
  const u = await User.findActiveAdminByEmail('a@b.test');
  console.log('findActiveAdminByEmail ->', u ? 'FOUND' : 'null');
} catch (e) {
  console.log('THREW:', e.name, '|', e.message.slice(0,150));
}
await mongoose.connection.db.dropDatabase();
await mongoose.disconnect(); process.exit(0);
