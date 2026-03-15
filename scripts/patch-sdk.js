/**
 * Postinstall patch for vscode-jsonrpc ESM compatibility.
 *
 * vscode-jsonrpc ≤8.x ships without an `exports` map in its package.json.
 * Under Node.js ESM resolution this means bare sub-path imports such as
 *   import { … } from "vscode-jsonrpc/node"
 * fail with ERR_MODULE_NOT_FOUND because the resolver won't try adding `.js`.
 *
 * This script injects a minimal `exports` map into vscode-jsonrpc's
 * package.json so that both `vscode-jsonrpc/node` and `vscode-jsonrpc/node.js`
 * resolve correctly.  It also keeps the previous session.js rewrite as a
 * belt-and-suspenders fallback.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from the package dir to find a node_modules containing the target
function findPkgDir(pkg) {
  let dir = join(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', ...pkg.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/* ── 1. Patch vscode-jsonrpc/package.json with an exports map ─────────── */

const jsonrpcDir = findPkgDir('vscode-jsonrpc');
const jsonrpcPkg = jsonrpcDir ? join(jsonrpcDir, 'package.json') : null;

if (jsonrpcPkg) {
  try {
    const raw = readFileSync(jsonrpcPkg, 'utf8');
    const pkg = JSON.parse(raw);

    if (!pkg.exports) {
      pkg.exports = {
        '.':          './lib/node/main.js',
        './node':     './node.js',
        './node.js':  './node.js',
        './browser':     './browser.js',
        './browser.js':  './browser.js',
        './lib/*':       './lib/*',
      };
      writeFileSync(jsonrpcPkg, JSON.stringify(pkg, null, '\t') + '\n', 'utf8');
      console.log('✔ Patched vscode-jsonrpc/package.json with exports map');
    } else {
      console.log('✔ vscode-jsonrpc/package.json already has exports map');
    }
  } catch (err) {
    console.warn('⚠ Could not patch vscode-jsonrpc/package.json:', err.message);
  }
} else {
  console.log('⚠ vscode-jsonrpc not found — skipping exports patch');
}

/* ── 2. Fallback: rewrite bare imports in @github/copilot-sdk dist ────── */

const sdkDir = findPkgDir('@github/copilot-sdk');
const sdkDist = sdkDir ? join(sdkDir, 'dist') : null;

if (sdkDist && existsSync(sdkDist)) {
  for (const file of ['session.js', 'client.js']) {
    const target = join(sdkDist, file);
    if (!existsSync(target)) continue;

    const content = readFileSync(target, 'utf8');
    const patched = content.replace(
      /from\s+"vscode-jsonrpc\/node"/g,
      'from "vscode-jsonrpc/node.js"',
    );

    if (content !== patched) {
      writeFileSync(target, patched, 'utf8');
      console.log(`✔ Patched @github/copilot-sdk dist/${file} (bare import fix)`);
    }
  }
} else {
  console.log('⚠ @github/copilot-sdk not found — skipping import rewrite');
}
