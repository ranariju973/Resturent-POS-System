import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { runInTenant } from './src/utils/tenantContext.js';
import { Order } from './src/models/Order.js';
import { Expense } from './src/models/Expense.js';
import { Attendance } from './src/models/Attendance.js';
import { Payroll } from './src/models/Payroll.js';
import { Counter } from './src/models/Counter.js';

await mongoose.connect(env.MONGO_URI);

const fakeTenantId = new mongoose.Types.ObjectId();

try {
  await runInTenant(fakeTenantId, async () => {
    const tenantId = fakeTenantId;

    await Order.deleteMany({});
    await Expense.deleteMany({});
    await Attendance.deleteMany({});
    await Payroll.deleteMany({});

    await Counter.deleteMany({
      _id: { $regex: new RegExp(`:${String(tenantId)}(:|$)`) },
    });
    
    console.log("Success");
  });
} catch (e) {
  console.log("ERROR IS", e.name, e.message, e.path, e.value);
}
process.exit(0);
