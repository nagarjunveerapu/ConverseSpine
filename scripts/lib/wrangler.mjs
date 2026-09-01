/**
 * Run wrangler from a Node script, on any operating system.
 *
 * WHY THIS EXISTS
 *
 * `scripts/embed-pipeline.mjs` used to call `execFileSync('npx', ['wrangler',
 * ...])`. That works on macOS and Linux and cannot work on Windows: `npx`
 * there is `npx.cmd`, and Node's own documentation says `.bat` and `.cmd`
 * files "cannot be launched using child_process.execFile()".
 *
 * `shell: true` is NOT the fix. These callers pass SQL as an argv element:
 *
 *     runWrangler(['d1', 'execute', DB, '--command', "SELECT 'a b'"])
 *
 * Through a shell that string is re-parsed, and quoting it correctly differs
 * between sh and cmd.exe. The argv stays argv here.
 *
 * Instead we resolve wrangler's own JavaScript entry point and run it with the
 * Node interpreter that is already running us. No shell, no `.cmd`, no PATH
 * lookup, and the same code path on all three platforms.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cached;

/** Absolute path to wrangler's CLI entry (`wrangler/bin/wrangler.js`). */
export function wranglerEntry() {
  if (cached) return cached;
  try {
    cached = require.resolve('wrangler/bin/wrangler.js');
  } catch {
    // Older/newer layouts declare the path in `bin` rather than shipping that
    // exact file. Fall back to reading it out of wrangler's own manifest.
    const pkgPath = require.resolve('wrangler/package.json');
    const pkg = require('wrangler/package.json');
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.wrangler;
    if (!rel) {
      throw new Error(
        'Could not locate wrangler\'s CLI entry point. Is wrangler installed? Try `npm ci`.',
      );
    }
    cached = new URL(rel, `file://${pkgPath}`).pathname;
  }
  return cached;
}

/**
 * Build the argv for `execFileSync(process.execPath, …)`. A leading 'wrangler'
 * is tolerated and dropped, so a call site converts by swapping `'npx'` for
 * `process.execPath` and wrapping the array it already had:
 *
 *     execFileSync('npx', args, opts)
 *     execFileSync(process.execPath, wranglerArgv(args), opts)
 */
export function wranglerArgv(args = []) {
  const rest = args[0] === 'wrangler' ? args.slice(1) : args;
  return [wranglerEntry(), ...rest];
}

/**
 * Spawn wrangler with the given argv. Options match execFileSync; `encoding`
 * defaults to utf8 and the buffer is raised because D1 `--json` dumps are big.
 */
export function runWrangler(args, opts = {}) {
  return execFileSync(process.execPath, wranglerArgv(args), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}
