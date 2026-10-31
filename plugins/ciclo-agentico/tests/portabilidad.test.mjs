import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Límite alfanumérico en vez de \b, para detectar también S3_BUCKET o sigmetum_a
const prohibidos = ['sigmetum', 'S3', 'express'].map(
  (t) => new RegExp(`(?<![A-Za-z0-9])${t}(?![A-Za-z0-9])`, 'i'),
);

// Devuelve "línea: "término"" por cada término prohibido encontrado en el texto
function buscarProhibidos(texto) {
  const hallazgos = [];
  texto.split(/\r?\n/).forEach((linea, i) => {
    for (const patron of prohibidos) {
      const m = patron.exec(linea);
      if (m) hallazgos.push(`${i + 1}: "${m[0]}"`);
    }
  });
  return hallazgos;
}

function archivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return ruta === join(raiz, 'tests') ? [] : archivos(ruta);
    return [ruta];
  });
}

test('buscarProhibidos detecta los términos pegados a guiones bajos y sin distinguir mayúsculas', () => {
  for (const linea of ['usa Express', 'un bucket s3', 'S3_BUCKET', 'AWS_S3_X', 'sigmetum_a', 'SIGMETUM-A']) {
    assert.equal(buscarProhibidos(linea).length, 1, `debería detectar: ${linea}`);
  }
});

test('buscarProhibidos respeta los límites de palabra alfanuméricos', () => {
  for (const linea of ['S30', 'expresso', 'expressly', 'MS3', 'sigmetuma']) {
    assert.deepEqual(buscarProhibidos(linea), [], `no debería detectar: ${linea}`);
  }
});

test('buscarProhibidos indica el número de línea', () => {
  assert.deepEqual(buscarProhibidos('limpia\r\nusa S3_BUCKET'), ['2: "S3"']);
});

test('el plugin no nombra el proyecto, su pila ni su nube', () => {
  const hallazgos = archivos(raiz).flatMap((ruta) =>
    buscarProhibidos(readFileSync(ruta, 'utf8')).map((h) => `${relative(raiz, ruta)}:${h}`),
  );
  assert.deepEqual(hallazgos, [], `Términos prohibidos:\n${hallazgos.join('\n')}`);
});
