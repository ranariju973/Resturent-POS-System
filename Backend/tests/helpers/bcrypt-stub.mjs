/**
 * Pure-JS stand-in for `bcrypt`, used only by tests/http-security.test.mjs.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `bcrypt` is a native module: `npm install` compiles a binary for the host
 * platform. A node_modules tree built on macOS therefore cannot run on Linux
 * (and vice versa) — the loader reports "invalid ELF header". That makes the
 * live HTTP test unrunnable anywhere the binary does not match, including CI
 * containers and Docker builds.
 *
 * ── What this does and does not affect ─────────────────────────────────────
 * The HTTP security tests never exercise a SUCCESSFUL credential check. Every
 * login they make is rejected by sanitising or schema validation before bcrypt
 * is reached; the module is imported only because authController pulls it in
 * at load time to build its timing decoy.
 *
 * So this substitutes a module that is never meaningfully called. It does NOT
 * make those tests weaker — but it also means they prove nothing about
 * password hashing. Real hashing behaviour is covered by the Phase 2 audit and
 * belongs in the Phase 12 integration tests, which need a database anyway.
 *
 * NEVER import this from application code.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const PREFIX = '$stub$';

const digest = (value, cost) =>
  createHash('sha256').update(`${cost}:${value}`).digest('hex');

export async function hash(value, cost = 10) {
  return `${PREFIX}${cost}$${digest(String(value), cost)}`;
}

export function hashSync(value, cost = 10) {
  return `${PREFIX}${cost}$${digest(String(value), cost)}`;
}

export async function compare(value, stored) {
  return compareSync(value, stored);
}

export function compareSync(value, stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return false;
  const [, cost, expected] = stored.split('$').slice(1);
  const actual = digest(String(value), cost);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const genSalt = async () => 'stub-salt';
export const getRounds = () => 10;

export default { hash, hashSync, compare, compareSync, genSalt, getRounds };
