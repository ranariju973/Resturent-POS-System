import mongoose from 'mongoose';
import { User } from './src/models/User.js';
import { signAccessToken } from './src/utils/jwt.js';
import { env } from './src/config/env.js';
import { runUnscoped } from './src/utils/tenantContext.js';

await mongoose.connect(env.MONGO_URI);

const admin = await runUnscoped('test', () => User.findOne({ email: env.SEED_ADMIN_EMAIL }));
const token = signAccessToken({
  id: admin._id,
  role: admin.role,
  tokenVersion: admin.tokenVersion ?? 0,
  tenantId: admin.tenantId ?? null,
});

console.log(token);
process.exit(0);
