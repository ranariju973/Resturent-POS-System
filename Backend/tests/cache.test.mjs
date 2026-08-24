/**
 * Cache behaviour.
 *
 * Most of this suite asserts against source text. This one actually runs the
 * cache, because the things that go wrong with a cache — an entry that outlives
 * its TTL, a failure stored and served for the next 30 seconds, a prefix delete
 * that takes neighbouring keys with it — are all behaviour, and none of them
 * are visible in a regex over the file.
 */
import mongoose from 'mongoose';
import * as cache from '../src/utils/cache.js';
import { runInTenant } from '../src/utils/tenantContext.js';
import {
  isCacheableItemQuery,
  invalidateMenu,
  rememberItems,
  menuItemsKey,
  menuCategoriesKey,
} from '../src/utils/menuCache.js';
import { rememberUser, invalidateUsers } from '../src/utils/userCache.js';

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('--- keys are namespaced ---');
{
  const k = cache.key('menu', 'items');
  t('a key built outside a request falls back to the global namespace',
    k === 'pos:global:menu:items', k);

  /*
   * The tenant segment is the whole point: it is what stops one restaurant's
   * cached menu being served to another. Asserting that two restaurants
   * produce DIFFERENT keys is the property — asserting the prefix merely
   * describes the format.
   */
  const alpha = String(new mongoose.Types.ObjectId());
  const beta = String(new mongoose.Types.ObjectId());
  const alphaKey = runInTenant(alpha, () => cache.key('menu', 'items'));
  const betaKey = runInTenant(beta, () => cache.key('menu', 'items'));

  t('a key inside a request carries that restaurant\'s id',
    alphaKey === `pos:${alpha}:menu:items`, alphaKey);
  t('two restaurants never share a cache key for the same data',
    alphaKey !== betaKey);
  t('and neither collides with the global namespace',
    alphaKey !== k && betaKey !== k);
}

console.log('\n--- get / set / del ---');
{
  cache.clearAll();
  t('a miss is null, not undefined', (await cache.get('pos:default:nope')) === null);

  await cache.set('pos:default:a', { v: 1 }, 1000);
  const hit = await cache.get('pos:default:a');
  t('a stored value comes back', hit?.v === 1);

  await cache.del('pos:default:a');
  t('a deleted key is a miss', (await cache.get('pos:default:a')) === null);
}

console.log('\n--- entries expire ---');
{
  cache.clearAll();
  await cache.set('pos:default:short', 'x', 20);
  t('live before the TTL', (await cache.get('pos:default:short')) === 'x');
  await sleep(35);
  t('gone after the TTL', (await cache.get('pos:default:short')) === null);
  // Expiry is checked on read, so the entry should not still be occupying the
  // map after that read reported a miss.
  t('an expired entry is evicted, not just hidden', cache.size() === 0, `size=${cache.size()}`);
}

console.log('\n--- delPrefix takes a family, not the neighbours ---');
{
  cache.clearAll();
  await cache.set(cache.key('stats', 'dashboard', 'admin'), 1, 1000);
  await cache.set(cache.key('stats', 'report', 'daily', '2026-01-01'), 2, 1000);
  await cache.set(cache.key('menu', 'items'), 3, 1000);

  await cache.delPrefix(cache.key('stats'));

  t('every stats key is gone', (await cache.get(cache.key('stats', 'dashboard', 'admin'))) === null);
  t('...including the nested one', (await cache.get(cache.key('stats', 'report', 'daily', '2026-01-01'))) === null);
  t('the menu was left alone', (await cache.get(cache.key('menu', 'items'))) === 3);
}

console.log('\n--- remember() computes once ---');
{
  cache.clearAll();
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return { n: calls };
  };

  const first = await cache.remember('pos:default:memo', 1000, compute);
  const second = await cache.remember('pos:default:memo', 1000, compute);

  t('the first call computes', first.n === 1);
  t('the second call does NOT', calls === 1, `calls=${calls}`);
  t('and returns the same value', second.n === 1);
}

console.log('\n--- a failure is never cached ---');
{
  cache.clearAll();
  let attempts = 0;
  const flaky = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('database went away');
    return 'recovered';
  };

  let threw = false;
  try {
    await cache.remember('pos:default:flaky', 1000, flaky);
  } catch {
    threw = true;
  }
  t('the error reaches the caller', threw);
  // The failure mode this guards: storing a rejection would serve the same
  // error to every request for the rest of the TTL, turning a blip into an
  // outage that outlives its cause.
  t('nothing was stored for the failure', cache.size() === 0, `size=${cache.size()}`);
  t('the next call retries and succeeds', (await cache.remember('pos:default:flaky', 1000, flaky)) === 'recovered');
}

console.log('\n--- only the till\'s plain menu read is cacheable ---');
{
  t('no filters -> cacheable', isCacheableItemQuery({}));
  t('includeInactive=false is still cacheable', isCacheableItemQuery({ includeInactive: 'false' }));

  // Search terms come from whatever a user types. Caching per term would be an
  // unbounded key space in a Map with no eviction.
  t('a search is NOT cacheable', !isCacheableItemQuery({ search: 'chai' }));
  t('a category filter is NOT cacheable', !isCacheableItemQuery({ category: 'abc123' }));
  t('an availability filter is NOT cacheable', !isCacheableItemQuery({ available: 'true' }));
  t('includeInactive=true is NOT cacheable', !isCacheableItemQuery({ includeInactive: 'true' }));
}

console.log('\n--- invalidateMenu drops both halves ---');
{
  cache.clearAll();
  await cache.set(menuItemsKey(), ['item'], 60_000);
  await cache.set(menuCategoriesKey(), ['cat'], 60_000);

  await invalidateMenu();

  t('items are dropped', (await cache.get(menuItemsKey())) === null);
  // Categories carry per-category item counts, so an item write changes the
  // categories payload too. Dropping only the "obvious" one is how counts drift.
  t('categories are dropped with them', (await cache.get(menuCategoriesKey())) === null);
}

console.log('\n--- rememberItems uses the shared key ---');
{
  cache.clearAll();
  await rememberItems(async () => ({ items: [], count: 0 }));
  t('it wrote to the key invalidateMenu clears', (await cache.get(menuItemsKey())) !== null);
}

console.log('\n--- invalidateUsers clears every session, not one ---');
{
  cache.clearAll();
  await cache.set(cache.key('user', 'aaa'), { role: 'admin' }, 60_000);
  await cache.set(cache.key('user', 'bbb'), { role: 'cashier' }, 60_000);
  await cache.set(cache.key('menu', 'items'), ['unrelated'], 60_000);

  await invalidateUsers();

  // A demoted cashier's cached role must not survive, and neither must anyone
  // else's — the model hook cannot know which id a query-level update touched,
  // so it drops the family rather than guessing.
  t('the first user is cleared', (await cache.get(cache.key('user', 'aaa'))) === null);
  t('the second user is cleared', (await cache.get(cache.key('user', 'bbb'))) === null);
  t('unrelated caches survive', (await cache.get(cache.key('menu', 'items'))) !== null);
}

console.log('\n--- user entries expire on their own too ---');
{
  cache.clearAll();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return { role: 'cashier', isActive: true };
  };

  await rememberUser('u1', load);
  await rememberUser('u1', load);
  // The burst this exists for: one bill used to make four or five requests,
  // each repeating the same lookup for the same person.
  t('a burst of requests costs one lookup', loads === 1, `loads=${loads}`);

  await invalidateUsers();
  await rememberUser('u1', load);
  t('after invalidation it loads again', loads === 2, `loads=${loads}`);
}

cache.clearAll();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
