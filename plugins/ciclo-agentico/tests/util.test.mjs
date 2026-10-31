import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerJson, quitarBom, normalizarFinesDeLinea, normalizarRuta, escaparRegExp } from '../scripts/lib/util.mjs';

const BOM = String.fromCharCode(0xfeff);

const conArchivo = (texto, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'util-'));
  try {
    const ruta = join(dir, 'a.json');
    writeFileSync(ruta, texto);
    return fn(ruta);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('quitarBom quita solo un BOM inicial', () => {
  assert.equal(quitarBom(`${BOM}{}`), '{}');
  assert.equal(quitarBom('{}'), '{}');
  assert.equal(quitarBom(`a${BOM}`), `a${BOM}`);
});

test('normalizarFinesDeLinea convierte CRLF en LF y deja LF igual', () => {
  assert.equal(normalizarFinesDeLinea('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizarFinesDeLinea('a\nb'), 'a\nb');
});

test('normalizarRuta cambia las barras invertidas por "/"', () => {
  assert.equal(normalizarRuta('routes\\sub\\a.js'), 'routes/sub/a.js');
  assert.equal(normalizarRuta('routes/a.js'), 'routes/a.js');
});

test('escaparRegExp busca el texto literal', () => {
  const especial = 'a.b*c+?^${}()|[]\\/-';
  assert.ok(new RegExp(`^${escaparRegExp(especial)}$`).test(especial));
  assert.ok(!new RegExp(`^${escaparRegExp('a.b')}$`).test('axb'));
});

test('leerJson acepta BOM inicial y CRLF', () => {
  const valor = conArchivo(`${BOM}{\r\n  "a": [1, 2],\r\n  "b": "x"\r\n}\r\n`, leerJson);
  assert.deepEqual(valor, { a: [1, 2], b: 'x' });
});

test('leerJson deja que el llamador gestione los errores', () => {
  assert.throws(() => conArchivo('{ roto', leerJson), SyntaxError);
  assert.throws(() => leerJson(join(tmpdir(), 'no-existe-util-test', 'a.json')), { code: 'ENOENT' });
});
