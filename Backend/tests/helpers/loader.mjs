/**
 * ESM resolve hook that redirects `bcrypt` to the pure-JS stub.
 *
 * Registered with `node --import ./tests/helpers/register.mjs`. See
 * bcrypt-stub.mjs for why this is needed and what it does not cover.
 */
// Resolved straight to a href. Do NOT round-trip through `.pathname` and
// pathToFileURL — that double-encodes, and the project path contains a space.
const STUB = new URL('./bcrypt-stub.mjs', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'bcrypt') return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
