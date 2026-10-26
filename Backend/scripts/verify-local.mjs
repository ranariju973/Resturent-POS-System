// A fixed disposable target: this runner can never inherit a production URI.
process.env.MONGO_URI = 'mongodb://127.0.0.1:27029/pos_reliability_test?replicaSet=pos-reliability';
process.env.NODE_ENV = 'test';
process.argv.push('--integration');
await import('../tests/run.mjs');
