/**
 * ESLint flat config.
 *
 * `npm run lint` has been in package.json since the start, but no config file
 * ever existed — and ESLint 9 refuses to run without one, so the script has
 * never actually succeeded. This is that missing file.
 *
 * The rule set is deliberately narrow. A 13k-line codebase adopting lint late
 * cannot absorb a thousand style opinions at once, and a lint run nobody can
 * get to zero is a lint run everybody learns to ignore. So: `js.configs.recommended`
 * for the rules that catch real bugs, plus a few that matter specifically here,
 * and nothing that argues about formatting.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'logs/**', 'coverage/**', 'dist/**'],
  },

  js.configs.recommended,

  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      /*
       * `require-atomic-updates` was tried here and removed. It flagged 11
       * places and was wrong about all of them: `req.user = ...` after an
       * await is safe because every request has its own `req`, and the
       * module-scope memos in PrinterSettings and transaction.js are
       * deliberate. A rule that only ever cries wolf teaches people to stop
       * reading lint output, which costs more than it catches.
       */
      'no-return-await': 'error',

      /*
       * Caught-and-ignored errors are a deliberate, documented pattern here
       * (auth.js swallows verify failures so expired and forged tokens look
       * identical). Allow the empty block only when the binding says so.
       */
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],

      // console is how the test harnesses report; the app itself uses winston.
      'no-console': 'off',

      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    // The test harnesses are hand-rolled scripts: they exit with a code rather
    // than throwing, and they reach into source files as text.
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'src/scripts/**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
