// Includes task-owned untracked sources, which git diff --check cannot see.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const office3d = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const paths = [
  'OfficeScene3D.tsx', 'office-scene-3d.css', 'scene.browser-check.mjs', 'scene.browser-fixture.tsx',
  'gfx29/lighting/index.ts', 'gfx29/lighting/lighting.test.ts', 'gfx29/lighting/REPORT.md',
  'gfx29/integration/art-direction.ts', 'gfx29/integration/premium.browser-check.mjs',
  'gfx29/integration/firefox.browser-check.mjs', 'gfx29/integration/verify-format.mjs',
  'gfx29/integration/REPORT.md',
];
const errors = [];
for (const path of paths) {
  const source = await readFile(resolve(office3d, path), 'utf8');
  source.split('\n').forEach((line, index) => { if (/[\t ]+$/.test(line)) errors.push(`${path}:${index + 1}: trailing whitespace`); });
  if (!source.endsWith('\n')) errors.push(`${path}: missing final newline`);
  if (source.includes('\r')) errors.push(`${path}: expected LF line endings`);
  if (/\.(ts|tsx|mjs)$/.test(path)) {
    const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
    for (const diagnostic of file.parseDiagnostics) errors.push(`${path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
}
if (errors.length) throw new Error(errors.join('\n'));
const result = { status: 'PASS', files: paths.length, includesUntracked: true, checks: ['trailing whitespace', 'final newline', 'LF', 'TS/TSX/JS parsing'] };
await writeFile(resolve(office3d, 'gfx29/integration/screenshots/format-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(result);
