import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Arquivos que só têm "fiação" de processo (top-level await / CLI) e ficam fora da cobertura.
const EXCLUDED = new Set(['index.js', 'seed-cli.js']);
const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function listJs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listJs(path.join(dir, e.name))
      : e.name.endsWith('.js')
        ? [path.join(dir, e.name)]
        : [],
  );
}

// Sem isto o relatório de cobertura só mostra arquivos que algum teste importou — escondendo os não testados.
test('todo arquivo de src/ é carregado pela suíte (nenhum fica invisível à cobertura)', async () => {
  const files = listJs(srcDir).filter((f) => !EXCLUDED.has(path.relative(srcDir, f)));
  assert.ok(files.length >= 20);
  for (const f of files) await import(pathToFileURL(f).href);
});
