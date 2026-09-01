#!/usr/bin/env node
/**
 * Set environment variables, then run a command. Portable `VAR=value cmd`.
 *
 *   node scripts/with-env.mjs KEY=value [KEY=value…] -- <command> [args…]
 *
 * npm runs scripts through `/bin/sh` on macOS and Linux but through `cmd.exe`
 * on Windows, and cmd.exe has no `VAR=value cmd` form — it reads the whole
 * `EVAL_MODE=scenarios` token as the name of a program to run and fails with
 * "not recognized".
 *
 * This is `cross-env` in fifteen lines, without the dependency.
 */
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) {
  console.error('usage: node scripts/with-env.mjs KEY=value [KEY=value…] -- <command> [args…]');
  process.exit(2);
}

const env = { ...process.env };
for (const pair of argv.slice(0, sep)) {
  const eq = pair.indexOf('=');
  if (eq < 1) { console.error(`✘ not a KEY=value pair: ${pair}`); process.exit(2); }
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const [cmd, ...args] = argv.slice(sep + 1);

// `shell` on Windows only: the binaries reached here (tsx, vitest, npm) are
// `.cmd` shims, which Node cannot spawn directly. Every command passed in
// comes from this repo's own package.json — never from user input.
//
// Keep it that way: with `shell: true` Node joins argv into ONE string and does
// NOT quote it, so an argument containing `;`, `(`, `)`, `&` or `^` is re-read
// by cmd.exe. Today every caller passes plain paths and flags. If one ever
// needs to pass an expression, it must not come through here.
const r = spawnSync(cmd, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
  windowsHide: true,
});
process.exit(r.status ?? 1);
