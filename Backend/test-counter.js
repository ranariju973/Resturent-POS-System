import mongoose from 'mongoose';
import { Counter } from './src/models/Counter.js';
import { env } from './src/config/env.js';
await mongoose.connect(env.MONGO_URI);
try {
  await Counter.deleteMany({
    _id: { $regex: new RegExp(`:testid(:|$)`) },
  });
  console.log("Success");
} catch (e) {
  console.log(e.name, e.message, e.path, e.value);
}
process.exit(0);
