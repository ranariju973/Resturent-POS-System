/** Only operates on the disposable local replica set used by this project. */
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://127.0.0.1:27029/?directConnection=true', {
  serverSelectionTimeoutMS: 5000,
});
try {
  await client.connect();
  const admin = client.db('admin');
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({ replSetInitiate: {
      _id: 'pos-reliability', members: [{ _id: 0, host: '127.0.0.1:27029' }],
    } });
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await admin.command({ hello: 1 })).isWritablePrimary) {
      console.log('Disposable local replica set is ready on port 27029.');
      break;
    }
    if (attempt === 59) throw new Error('Replica set did not elect a primary');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  await client.close();
}
