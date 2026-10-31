import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarFlujo, cargarFlujo, OPCIONALES } from '../scripts/lib/flujo.mjs';

const valido = () => ({
  guias: ['docs/guias/buenas-practicas.md'],
  estado: 'docs/estado.md',
  estadoFecha: 'Actualizado el (\\d{2}/\\d{2}/\\d{4})',
  verificacion: { lint: 'npm run lint' },
  specsDir: 'docs/specs',
  maxVueltas: 3,
  consultor: 'octopus',
  estilo: 'i-have-adhd',
  perfiles: ['backend'],
  docsObligatorios: ['docs/estado.md'],
  docsPorArea: { 'routes/**': ['docs/rutas.md'] },
  areasContrato: ['routes/'],
  avisoPR: 'docs/aviso-*.md',
});

const obligatorios = Object.keys(valido());

test('configuración válida es ok', () => {
  assert.deepEqual(validarFlujo(valido()), { ok: true, problemas: [] });
});

test('acepta los campos opcionales sin forma exigida con cualquier valor', () => {
  const libres = OPCIONALES.filter((campo) => campo !== 'marketplaceLocal');
  assert.ok(libres.length > 0);
  for (const campo of libres) {
    for (const valor of [{}, [], 'x']) {
      assert.equal(validarFlujo({ ...valido(), [campo]: valor }).ok, true, `${campo}: ${JSON.stringify(valor)}`);
    }
  }
});

test('ningún campo opcional es obligatorio', () => {
  for (const campo of OPCIONALES) assert.ok(!obligatorios.includes(campo), campo);
});

test('acepta marketplaceLocal como ruta relativa con barras', () => {
  assert.equal(validarFlujo({ ...valido(), marketplaceLocal: 'plugins' }).ok, true);
  assert.equal(validarFlujo({ ...valido(), marketplaceLocal: 'herramientas/plugins' }).ok, true);
  assert.equal(validarFlujo({ ...valido(), marketplaceLocal: './plugins' }).ok, true);
});

test('marketplaceLocal fuera del proyecto (segmento "..", ruta absoluta o letra de unidad) es problema claro', () => {
  for (const malo of ['..', '../plugins', 'plugins/..', 'a/../b', './../plugins', '/plugins', '/', 'C:', 'C:/plugins', 'c:plugins']) {
    const { ok, problemas } = validarFlujo({ ...valido(), marketplaceLocal: malo });
    assert.equal(ok, false, malo);
    assert.ok(
      problemas.some((p) => p.includes('marketplaceLocal') && p.includes('dentro del proyecto')),
      `${malo}: ${JSON.stringify(problemas)}`,
    );
  }
});

test('marketplaceLocal que no es texto o con caracteres no permitidos es problema', () => {
  for (const malo of [3, ['plugins'], '', 'mis plugins', 'a&b', '-plugins', 'a\\b']) {
    const { ok, problemas } = validarFlujo({ ...valido(), marketplaceLocal: malo });
    assert.equal(ok, false, JSON.stringify(malo));
    assert.ok(problemas.some((p) => p.includes('marketplaceLocal')), JSON.stringify(malo));
  }
});

for (const campo of obligatorios) {
  test(`falta ${campo}: un problema que nombra el campo`, () => {
    const flujo = valido();
    delete flujo[campo];
    const { ok, problemas } = validarFlujo(flujo);
    assert.equal(ok, false);
    assert.equal(problemas.length, 1);
    assert.ok(problemas[0].includes(campo), problemas[0]);
  });
}

test('maxVueltas 0 es problema', () => {
  const { ok, problemas } = validarFlujo({ ...valido(), maxVueltas: 0 });
  assert.equal(ok, false);
  assert.ok(problemas.some((p) => p.includes('maxVueltas')));
});

test('maxVueltas no entero es problema', () => {
  assert.equal(validarFlujo({ ...valido(), maxVueltas: 1.5 }).ok, false);
});

test('consultor desconocido es problema', () => {
  const { ok, problemas } = validarFlujo({ ...valido(), consultor: 'otro' });
  assert.equal(ok, false);
  assert.ok(problemas.some((p) => p.includes('consultor')));
});

test('estilo desconocido es problema', () => {
  const { problemas } = validarFlujo({ ...valido(), estilo: 'otro' });
  assert.ok(problemas.some((p) => p.includes('estilo')));
});

test('estadoFecha con regex inválida es problema', () => {
  const { ok, problemas } = validarFlujo({ ...valido(), estadoFecha: '(sin cerrar' });
  assert.equal(ok, false);
  assert.ok(problemas.some((p) => p.includes('estadoFecha')));
});

test('estadoFecha sin grupo de captura es problema', () => {
  const { problemas } = validarFlujo({ ...valido(), estadoFecha: '\\d{2}/\\d{2}/\\d{4}' });
  assert.ok(problemas.some((p) => p.includes('estadoFecha')));
});

test('estadoFecha con dos grupos es problema', () => {
  const { problemas } = validarFlujo({ ...valido(), estadoFecha: '(\\d+)/(\\d+)' });
  assert.ok(problemas.some((p) => p.includes('estadoFecha')));
});

test('docsPorArea con valores que no son arrays de strings es problema', () => {
  const { problemas } = validarFlujo({ ...valido(), docsPorArea: { 'a/**': 'docs/x.md' } });
  assert.ok(problemas.some((p) => p.includes('docsPorArea')));
});

test('acumula todos los problemas', () => {
  const { problemas } = validarFlujo({ ...valido(), maxVueltas: 0, consultor: 'otro', guias: 'x' });
  assert.ok(problemas.length >= 3);
});

test('una entrada que no es objeto es problema', () => {
  assert.equal(validarFlujo(null).ok, false);
  assert.equal(validarFlujo([]).ok, false);
});

const conCarpeta = (fn) => {
  const raiz = mkdtempSync(join(tmpdir(), 'flujo-'));
  try {
    fn(raiz);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
};

const escribir = (raiz, texto) => {
  mkdirSync(join(raiz, '.claude'), { recursive: true });
  writeFileSync(join(raiz, '.claude', 'flujo.json'), texto);
};

test('cargarFlujo sin archivo remite a /ciclo-init', () => {
  conCarpeta((raiz) => {
    const { flujo, problemas } = cargarFlujo(raiz);
    assert.equal(flujo, null);
    assert.ok(problemas.some((p) => p.includes('/ciclo-init')));
  });
});

test('cargarFlujo con JSON mal formado nombra la ruta', () => {
  conCarpeta((raiz) => {
    escribir(raiz, '{ no es json');
    const { flujo, problemas } = cargarFlujo(raiz);
    assert.equal(flujo, null);
    assert.ok(problemas.some((p) => p.includes(join(raiz, '.claude', 'flujo.json'))));
  });
});

test('cargarFlujo con configuración válida la devuelve', () => {
  conCarpeta((raiz) => {
    escribir(raiz, JSON.stringify(valido()));
    const { flujo, problemas } = cargarFlujo(raiz);
    assert.deepEqual(problemas, []);
    assert.deepEqual(flujo, valido());
  });
});

test('cargarFlujo con configuración inválida devuelve los problemas', () => {
  conCarpeta((raiz) => {
    escribir(raiz, JSON.stringify({ ...valido(), maxVueltas: 0 }));
    const { flujo, problemas } = cargarFlujo(raiz);
    assert.equal(flujo, null);
    assert.ok(problemas.some((p) => p.includes('maxVueltas')));
  });
});

test('cargarFlujo acepta un BOM UTF-8 inicial (editores de Windows)', () => {
  conCarpeta((raiz) => {
    escribir(raiz, String.fromCharCode(0xfeff) + JSON.stringify(valido()));
    const { flujo, problemas } = cargarFlujo(raiz);
    assert.deepEqual(problemas, []);
    assert.deepEqual(flujo, valido());
  });
});
