import { toTestUri } from './tests/integration/setup.mjs';
const cases = [
  'mongodb+srv://u:p@cluster0.abc.mongodb.net/restaurant_pos?retryWrites=true',
  'mongodb://127.0.0.1:27017/verdant_pos',
  'mongodb://127.0.0.1:27017/already_test',
  'mongodb://127.0.0.1:27017/',
];
for (const c of cases) {
  const { dbName } = toTestUri(c);
  const safe = dbName.endsWith('_test');
  console.log(`${safe ? 'SAFE  ' : 'UNSAFE'}  ${c.split('/').pop().slice(0,30).padEnd(32)} -> ${dbName}`);
}
