import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { purgeReports } from './src/controllers/dataPurgeController.js';
import { runInTenant } from './src/utils/tenantContext.js';

await mongoose.connect(env.MONGO_URI);
mongoose.set('sanitizeFilter', true); // Enable sanitizeFilter just like production!

const fakeTenantId = new mongoose.Types.ObjectId();
const fakeReq = {
  tenantId: fakeTenantId,
  user: { id: new mongoose.Types.ObjectId().toHexString() },
};

const fakeRes = {
  json: (data) => console.log('JSON:', data),
  status: function(code) { this.code = code; return this; }
};

try {
  await runInTenant(fakeTenantId, async () => {
    await purgeReports(fakeReq, fakeRes, (err) => {
      console.log("NEXT CALLED WITH ERROR:", err);
    });
  });
} catch (err) {
  console.log("CAUGHT ERROR:", err);
}
process.exit(0);
