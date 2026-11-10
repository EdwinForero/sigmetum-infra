import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (nombre) =>
  JSON.parse(readFileSync(join(raiz, '.claude-plugin', nombre), 'utf8'));

test('plugin.json declara nombre y versión', () => {
  const plugin = leer('plugin.json');
  assert.equal(plugin.name, 'ciclo-agentico');
  assert.equal(plugin.version, '0.1.1');
});

test('el primer encabezado del CHANGELOG es la versión de plugin.json', () => {
  const texto = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8');
  const primero = /^## (.+)$/m.exec(texto);
  assert.ok(primero, 'el CHANGELOG no tiene entradas');
  assert.equal(primero[1].trim(), '0.1.1');
  assert.equal(primero[1].trim(), leer('plugin.json').version);
});

test('CHANGELOG resume el contenido de la versión 0.1.1', () => {
  const texto = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const inicio = texto.indexOf('## 0.1.1');
  const fin = texto.indexOf('## 0.1.0');
  assert.ok(inicio !== -1 && fin > inicio, 'faltan las entradas 0.1.1 y 0.1.0 en ese orden');
  const seccion = texto.slice(inicio, fin);
  for (const pieza of ['model', 'effort', 'opus', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL', '/ciclo', 'escalado']) {
    assert.ok(seccion.includes(pieza), `la entrada 0.1.1 no menciona ${pieza}`);
  }
});

test('CHANGELOG resume el contenido de la versión 0.1.0', () => {
  const texto = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8');
  for (const pieza of ['/ciclo', '/ciclo-init', 'refresh-estado', 'principios', 'docs-gate', 'bootstrap-agentes', 'dependencias.json']) {
    assert.ok(texto.includes(pieza), `el CHANGELOG no menciona ${pieza}`);
  }
});
