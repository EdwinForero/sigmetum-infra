import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (nombre) =>
  JSON.parse(readFileSync(join(raiz, '.claude-plugin', nombre), 'utf8'));

test('plugin.json declara nombre y versión inicial', () => {
  const plugin = leer('plugin.json');
  assert.equal(plugin.name, 'ciclo-agentico');
  assert.equal(plugin.version, '0.1.0');
});

test('CHANGELOG resume el contenido de la versión 0.1.0', () => {
  const texto = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8');
  for (const pieza of ['/ciclo', '/ciclo-init', 'refresh-estado', 'principios', 'docs-gate', 'bootstrap-agentes', 'dependencias.json']) {
    assert.ok(texto.includes(pieza), `el CHANGELOG no menciona ${pieza}`);
  }
});
