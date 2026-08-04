/**
 * Executable model of the refresh-token session policy.
 *
 * ── What this is, and is not ───────────────────────────────────────────────
 * jsonwebtoken and mongoose cannot be loaded in every environment, so this
 * reimplements the branch order of authController.refresh/logout against an
 * in-memory store and asserts the resulting POLICY.
 *
 * It proves the policy is coherent — that rotation is single-use, that reuse
 * revokes exactly one session, that logout-all reaches live access tokens.
 * It does NOT prove the controller implements it; tests/auth-security.test.mjs
 * checks the source for each branch this model relies on, and the two are
 * meant to be read together. Real end-to-end coverage arrives in Phase 12.
 */

let pass = 0;
let fail = 0;
const t = (label, ok, note = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${note ? `  ${note}` : ''}`);
};

// --- In-memory stand-ins for the User and RefreshToken collections ---------

let seq = 0;
const uid = (p) => `${p}-${++seq}`;

function createStore() {
  const tokens = new Map(); // jti -> record
  const users = new Map(); // id -> { isActive, tokenVersion }

  return {
    tokens,
    users,

    addUser(id) {
      users.set(id, { id, isActive: true, tokenVersion: 0 });
      return users.get(id);
    },

    issue({ userId, family, tv }) {
      const jti = uid('jti');
      tokens.set(jti, {
        jti,
        user: userId,
        family,
        tv,
        expiresAt: Date.now() + 7 * 864e5,
        revokedAt: null,
        revokedReason: null,
        replacedBy: null,
      });
      return jti;
    },

    revokeFamily(family, reason) {
      let n = 0;
      for (const rec of tokens.values()) {
        if (rec.family === family && !rec.revokedAt) {
          rec.revokedAt = Date.now();
          rec.revokedReason = reason;
          n++;
        }
      }
      return n;
    },

    revokeAllForUser(userId, reason) {
      let n = 0;
      for (const rec of tokens.values()) {
        if (rec.user === userId && !rec.revokedAt) {
          rec.revokedAt = Date.now();
          rec.revokedReason = reason;
          n++;
        }
      }
      return n;
    },

    liveIn(family) {
      return [...tokens.values()].filter((r) => r.family === family && !r.revokedAt);
    },
  };
}

/** Mirrors completeLogin -> issueSession: a fresh family per login. */
function login(store, userId) {
  const user = store.users.get(userId);
  const family = uid('fam');
  const jti = store.issue({ userId, family, tv: user.tokenVersion });
  return { jti, family, accessTv: user.tokenVersion };
}

/**
 * Mirrors authController.refresh, in the same branch order.
 * @returns {{ok: true, jti: string}|{ok: false, reason: string}}
 */
function refresh(store, presentedJti) {
  const stored = store.tokens.get(presentedJti);
  if (!stored) return { ok: false, reason: 'unknown-token' };

  // --- reuse detection: already-rotated token presented again ---
  if (stored.revokedAt) {
    store.revokeFamily(stored.family, 'reuse-detected');
    return { ok: false, reason: 'reuse-detected' };
  }

  if (stored.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };

  const user = store.users.get(stored.user);
  if (!user || !user.isActive || stored.tv !== user.tokenVersion) {
    store.revokeFamily(stored.family, 'user-invalid');
    return { ok: false, reason: 'user-invalid' };
  }

  // Rotate inside the same family, then retire the presented token.
  const next = store.issue({ userId: stored.user, family: stored.family, tv: user.tokenVersion });
  stored.revokedAt = Date.now();
  stored.revokedReason = 'rotated';
  stored.replacedBy = next;

  return { ok: true, jti: next };
}

/** Mirrors authController.logout. */
function logout(store, presentedJti, { allDevices = false } = {}) {
  const stored = store.tokens.get(presentedJti);
  if (!stored) return;

  if (allDevices) {
    store.revokeAllForUser(stored.user, 'logout-all');
    const user = store.users.get(stored.user);
    if (user) user.tokenVersion += 1; // also invalidates live access tokens
  } else {
    store.revokeFamily(stored.family, 'logout');
  }
}

/** Mirrors requireAuth's tokenVersion check. */
const accessTokenValid = (store, userId, tv) => {
  const u = store.users.get(userId);
  return Boolean(u?.isActive) && u.tokenVersion === tv;
};

// ---------------------------------------------------------------------------

console.log('--- a refresh token is single-use ---');
{
  const s = createStore();
  s.addUser('u1');
  const { jti } = login(s, 'u1');

  const first = refresh(s, jti);
  t('first refresh succeeds', first.ok);
  t('it returns a NEW token', first.jti !== jti);
  t('the presented token is now revoked', s.tokens.get(jti).revokedAt !== null);
  t("revocation reason is 'rotated'", s.tokens.get(jti).revokedReason === 'rotated');
  t('rotation chain is traceable', s.tokens.get(jti).replacedBy === first.jti);
}

console.log('\n--- rotating repeatedly keeps exactly one live token ---');
{
  const s = createStore();
  s.addUser('u1');
  let { jti, family } = login(s, 'u1');

  for (let i = 0; i < 10; i++) {
    const r = refresh(s, jti);
    if (!r.ok) break;
    jti = r.jti;
  }
  const live = s.liveIn(family);
  t('10 rotations leave 1 live token', live.length === 1, `live=${live.length}`);
  t('the live one is the newest', live[0].jti === jti);
  t('11 records exist in the chain', [...s.tokens.values()].filter((r) => r.family === family).length === 11);
}

console.log('\n--- stolen token replay revokes the session ---');
{
  const s = createStore();
  s.addUser('u1');
  const { jti: original, family } = login(s, 'u1');

  // Attacker copies `original`. The victim's client refreshes normally first.
  const victim = refresh(s, original);
  t('victim rotates successfully', victim.ok);
  t('victim holds a live token', s.liveIn(family).length === 1);

  // Attacker now replays the token they copied.
  const attacker = refresh(s, original);
  t('attacker replay is rejected', !attacker.ok && attacker.reason === 'reuse-detected');
  t('ENTIRE family revoked, including the victim', s.liveIn(family).length === 0);

  // And the victim's freshly-rotated token is dead too — intended.
  const victimRetry = refresh(s, victim.jti);
  t('victim also forced to re-authenticate', !victimRetry.ok);
  t('reason recorded for investigation',
    s.tokens.get(victim.jti).revokedReason === 'reuse-detected');
}

console.log('\n--- reuse blast radius is one session, not the account ---');
{
  const s = createStore();
  s.addUser('u1');
  const terminal1 = login(s, 'u1');
  const terminal2 = login(s, 'u1');

  t('two logins create two families', terminal1.family !== terminal2.family);

  refresh(s, terminal1.jti); // rotate terminal 1
  const replay = refresh(s, terminal1.jti); // replay the old one
  t('replay detected on terminal 1', replay.reason === 'reuse-detected');
  t('terminal 1 session destroyed', s.liveIn(terminal1.family).length === 0);
  t('terminal 2 is UNAFFECTED', s.liveIn(terminal2.family).length === 1);
}

console.log('\n--- logout ---');
{
  const s = createStore();
  s.addUser('u1');
  const a = login(s, 'u1');
  const b = login(s, 'u1');

  logout(s, a.jti);
  t('single logout kills its own session', s.liveIn(a.family).length === 0);
  t('other sessions survive', s.liveIn(b.family).length === 1);
  t('logged-out token cannot refresh', !refresh(s, a.jti).ok);

  // A token copied before logout must not keep working for 7 days.
  t('a copy of the logged-out token is equally dead',
    s.tokens.get(a.jti).revokedAt !== null);
}

console.log('\n--- logout everywhere ---');
{
  const s = createStore();
  s.addUser('u1');
  const a = login(s, 'u1');
  const b = login(s, 'u1');
  const c = login(s, 'u1');

  t('3 live access tokens before', [a, b, c].every((x) => accessTokenValid(s, 'u1', x.accessTv)));

  logout(s, a.jti, { allDevices: true });

  t('every refresh token revoked',
    s.liveIn(a.family).length === 0 && s.liveIn(b.family).length === 0 && s.liveIn(c.family).length === 0);
  t('tokenVersion bumped', s.users.get('u1').tokenVersion === 1);
  t('all live ACCESS tokens now rejected too',
    [a, b, c].every((x) => !accessTokenValid(s, 'u1', x.accessTv)));
}

console.log('\n--- deactivating an account cuts sessions immediately ---');
{
  const s = createStore();
  s.addUser('u1');
  const { jti, family, accessTv } = login(s, 'u1');

  s.users.get('u1').isActive = false;

  t('access token rejected at once', !accessTokenValid(s, 'u1', accessTv));
  const r = refresh(s, jti);
  t('refresh rejected', !r.ok && r.reason === 'user-invalid');
  t('session revoked as a side effect', s.liveIn(family).length === 0);
}

console.log('\n--- a role change takes effect without waiting for expiry ---');
{
  const s = createStore();
  const u = s.addUser('u1');
  const { accessTv } = login(s, 'u1');

  // requireAuth reads role from the database every request, so a demotion is
  // live immediately. Forcing re-auth additionally kills the old token.
  u.tokenVersion += 1;
  t('old access token rejected after forced revoke', !accessTokenValid(s, 'u1', accessTv));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
