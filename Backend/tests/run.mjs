/**
 * Test runner.
 *
 * Replaces the shell loop that used to live in package.json:
 *
 *   for f in tests/*.test.mjs; do node --import ... "$f" || exit 1; done
 *
 * That had three problems, all of which matter more once CI is watching:
 *
 *   1. `|| exit 1` stopped at the FIRST failing suite, so a run told you about
 *      one broken thing at a time. Fixing six failures took six runs.
 *   2. It is bash. GitHub's windows runners and any non-POSIX shell can't run
 *      it at all.
 *   3. The glob `tests/*.test.mjs` is not recursive, so tests/integration/
 *      was silently excluded from the thing named "verify".
 *
 * This runs every suite, reports all of them, and exits non-zero if any failed.
 *
 * Usage:
 *   node tests/run.mjs                 unit suites (no database required)
 *   node tests/run.mjs --integration   also the integration suite (needs MONGO_URI)
 *   node tests/run.mjs --serial        one at a time, for readable debugging
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS_DIR, '..');
const REGISTER = path.join(TESTS_DIR, 'helpers', 'register.mjs');

const args = new Set(process.argv.slice(2));
const withIntegration = args.has('--integration');
// The unit suites touch no shared state, so they parallelise safely. The
// integration suite owns a database and must not run alongside anything.
const concurrency = args.has('--serial') ? 1 : 4;

/** Each suite prints its own tally; this reads it back so the total is real. */
const TALLY = /(\d+) passed, (\d+) failed/;

async function findSuites() {
  const entries = await readdir(TESTS_DIR, { withFileTypes: true });
  const unit = entries
    .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
    .map((e) => path.join(TESTS_DIR, e.name))
    .sort();
  return unit;
}

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ['--import', REGISTER, file],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });

    child.on('close', (code) => {
      const m = out.match(TALLY);
      resolve({
        file: path.relative(ROOT, file),
        code,
        ms: Date.now() - started,
        passed: m ? Number(m[1]) : 0,
        // A suite that dies before printing a tally (an import-time throw)
        // reports zero of each — the non-zero exit code is what fails the run,
        // so a crash can never be mistaken for "nothing to do".
        failed: m ? Number(m[2]) : 0,
        crashed: !m,
        out,
      });
    });
  });
}

/** Fixed-size worker pool. Keeps CI logs bounded and machines responsive. */
async function runAll(files, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, files.length) }, async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await runSuite(files[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function report(results) {
  let passed = 0;
  let failed = 0;
  const broken = [];

  for (const r of results) {
    passed += r.passed;
    failed += r.failed;
    const ok = r.code === 0 && !r.crashed;
    if (!ok) broken.push(r);
    const mark = ok ? 'ok  ' : 'FAIL';
    const tally = r.crashed ? 'no tally — suite crashed' : `${r.passed} passed, ${r.failed} failed`;
    process.stdout.write(`${mark} ${r.file.padEnd(42)} ${tally} (${r.ms}ms)\n`);
  }

  // Only the failing suites get their output reprinted. Dumping all 1,200
  // passing assertions into a CI log buries the one line that matters.
  for (const r of broken) {
    process.stdout.write(`\n${'─'.repeat(70)}\n${r.file}\n${'─'.repeat(70)}\n`);
    const lines = r.out.split('\n');
    const relevant = lines.filter((l) => /^FAIL|Error|error:/.test(l));
    process.stdout.write((relevant.length ? relevant.join('\n') : r.out.trim()) + '\n');
  }

  process.stdout.write(
    `\n${results.length} suites — ${passed} assertions passed, ${failed} failed`
    + `${broken.length ? `, ${broken.length} suite(s) not green` : ''}\n`,
  );
  return broken.length === 0;
}

const suites = await findSuites();
process.stdout.write(`Running ${suites.length} unit suites (concurrency ${concurrency})\n\n`);
let green = report(await runAll(suites, concurrency));

if (withIntegration) {
  process.stdout.write('\nIntegration suite (requires MONGO_URI; writes to a *_test database)\n\n');
  const integration = path.join(TESTS_DIR, 'integration', 'flow.test.mjs');
  green = report([await runSuite(integration)]) && green;
}

process.exit(green ? 0 : 1);
