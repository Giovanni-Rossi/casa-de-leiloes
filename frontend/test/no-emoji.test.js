// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

// Emojis, pictogramas e símbolos decorativos (setas, formas geométricas, dingbats) e o seletor
// de variação que transforma símbolos em emoji. Na interface, ícones vêm do lucide-react.
const EMOJI = new RegExp(
  '[\\u2190-\\u21FF\\u25A0-\\u25FF\\u2600-\\u27BF\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}]|\\uFE0F',
  'u',
);

describe('interface sem emojis', () => {
  it('nenhum arquivo de src/ contém emoji ou símbolo decorativo (use ícones do lucide-react)', () => {
    for (const f of files(src)) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const where = `${path.relative(src, f)}:${i + 1}: ${line.trim()}`;
          expect(EMOJI.test(line), where).toBe(false);
        });
    }
  });

  it('o detector reconhece emojis e aceita texto comum', () => {
    for (const sample of [
      '\u{1F528}', // martelo
      '\u2714', // check
      '\u2716', // x
      '\u25CF', // círculo
      '\u{1F3C6}', // troféu
      '\u2600\uFE0F', // sol
      '\u2197', // seta
    ])
      expect(EMOJI.test(sample)).toBe(true);
    for (const sample of ['Você está ganhando!', 'R$ 1.234,56', 'Encerrando…', 'ÍNTEGRO — ok']) {
      expect(EMOJI.test(sample)).toBe(false);
    }
  });
});
