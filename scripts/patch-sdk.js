/**
 * Postinstall patch for @github/copilot-sdk.
 *
 * The SDK's session.js imports `vscode-jsonrpc/node` without the `.js`
 * extension, which fails under Node.js ESM resolution when the
 * vscode-jsonrpc package lacks an `exports` map.
 *
 * This script fixes the import to use `vscode-jsonrpc/node.js`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk', 'dist', 'session.js');

if (!existsSync(target)) {
  // SDK not installed — nothing to patch
  process.exit(0);
}

const content = readFileSync(target, 'utf8');
const patched = content.replace(
  /from\s+"vscode-jsonrpc\/node"/g,
  'from "vscode-jsonrpc/node.js"',
);

if (content !== patched) {
  writeFileSync(target, patched, 'utf8');
  console.log('✔ Patched @github/copilot-sdk session.js (vscode-jsonrpc import fix)');
} else {
  console.log('✔ @github/copilot-sdk session.js already patched');
}
