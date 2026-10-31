import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  coincide,
  docsDeArea,
  fechaHoy,
  cambiosGit,
  evaluarGate,
  ejecutar,
} from '../scripts/docs-gate.mjs';

const flujoBase = () => ({
  estado: 'docs/estado.md',
  estadoFecha: 'actualizado (\\d{2}/\\d{2}/\\d{4})',
  docsObligatorios: ['docs/estado.md'],
  docsPorArea: {
    'routes/**': ['docs/api.md', 'docs/modulos.md'],
    'config/*.js': ['docs/config.md'],
  },
  areasContrato: ['routes/**'],
  avisoPR: 'docs/integracion/aviso-*.md',
  integracion: ['docs/integracion/para-*.md'],
});
// git en un repositorio temporal, con identidad fija para poder hacer commit
const gitEn = (dir) => (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
const LINEA = 'Integración: sin impacto — no cambia rutas ni respuestas';
const HOY = '27/10/2026';
const TEXTO_OK = `# Estado\nactualizado ${HOY}\n`;

test('coincide: comodines y barras invertidas', () => {
  assert.equal(coincide('routes/auth.js', 'routes/**'), true);
  assert.equal(coincide('routes\\auth.js', 'routes/**'), true);
  assert.equal(coincide('config/validateEnv.js', 'config/*.js'), true);
  assert.equal(coincide('config/a/b.js', 'config/*.js'), false);
  assert.equal(coincide('a/b.js', 'a/b.js'), true);
  assert.equal(coincide('a/bxjs', 'a/b.js'), false);
  assert.equal(coincide('routes/a/b/c.js', 'routes/**'), true);
});

test('docsDeArea: gana el patrón más específico', () => {
  const mapa = { 'config/**': ['A'], 'config/validateEnv.js': ['B'] };
  assert.deepEqual(docsDeArea('config/validateEnv.js', mapa), ['B']);
  assert.deepEqual(docsDeArea('config/otro.js', mapa), ['A']);
  assert.equal(docsDeArea('README.md', mapa), null);
});

test('docsDeArea: empate une sin duplicados', () => {
  const mapa = { 'a/*.js': ['X', 'Y'], 'a/*.mjs': ['Y', 'Z'] };
  assert.deepEqual(docsDeArea('a/f.js', mapa), ['X', 'Y']);
  const empate = { 'a/*.js': ['X', 'Y'], '*/b.js': ['Y', 'Z'] };
  assert.deepEqual(docsDeArea('a/b.js', empate), ['X', 'Y', 'Z']);
});

test('fechaHoy: DD/MM/AAAA con ceros', () => {
  assert.equal(fechaHoy(new Date(2026, 0, 5)), '05/01/2026');
  assert.equal(fechaHoy(new Date(2026, 9, 27)), '27/10/2026');
});

test('evaluarGate: falta el documento de estado (también en docsObligatorios) da un solo problema', () => {
  const r = evaluarGate({ cambios: ['README.md'], flujo: flujoBase(), hoy: HOY, textoEstado: TEXTO_OK });
  assert.equal(r.ok, false);
  assert.equal(r.problemas.filter((p) => p.includes('docs/estado.md')).length, 1);
});

test('evaluarGate: estado fuera de docsObligatorios también debe estar en cambios', () => {
  const flujo = { ...flujoBase(), docsObligatorios: [] };
  const r = evaluarGate({ cambios: ['README.md'], flujo, hoy: HOY, textoEstado: TEXTO_OK });
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some((p) => p.includes('docs/estado.md')));
});

test('evaluarGate: falla si la fecha no es hoy y nombra ambas', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: 'actualizado 01/01/2026',
  });
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some((p) => p.includes('01/01/2026') && p.includes(HOY)));
});

test('evaluarGate: sin fecha reconocible no lanza', () => {
  const r = evaluarGate({ cambios: ['docs/estado.md'], flujo: flujoBase(), hoy: HOY, textoEstado: 'nada' });
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some((p) => p.includes('no se encontró la fecha')));
});

test('evaluarGate: CRLF no afecta a la fecha', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: `# Estado\r\nactualizado ${HOY}\r\n`,
  });
  assert.deepEqual(r, { ok: true, problemas: [] });
});

test('evaluarGate: código sin documentos de su área', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md', 'config/x.js'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
  });
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some((p) => p.includes('config/x.js') && p.includes('docs/config.md')));
});

test('evaluarGate: código con documentos de su área es ok', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md', 'config/x.js', 'docs/config.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
  });
  assert.deepEqual(r, { ok: true, problemas: [] });
});

test('evaluarGate: área de contrato sin aviso falla; con aviso es ok', () => {
  const base = ['docs/estado.md', 'routes/a.js', 'docs/api.md'];
  const sin = evaluarGate({ cambios: base, flujo: flujoBase(), hoy: HOY, textoEstado: TEXTO_OK });
  assert.equal(sin.ok, false);
  assert.ok(sin.problemas.some((p) => p.includes('routes/a.js') && p.includes('docs/integracion/aviso-*.md')));
  const con = evaluarGate({
    cambios: [...base, 'docs/integracion/aviso-front.md', 'docs/integracion/para-front.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
  });
  assert.deepEqual(con, { ok: true, problemas: [] });
});

const CONTRATO = ['docs/estado.md', 'routes/a.js', 'docs/api.md', 'docs/integracion/aviso-front.md'];

test('evaluarGate: contrato con aviso y la línea "Integración: sin impacto — motivo" es ok', () => {
  const r = evaluarGate({
    cambios: CONTRATO,
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: { 'docs/integracion/aviso-front.md': `# Aviso\r\n\r\n${LINEA}\r\n` },
  });
  assert.deepEqual(r, { ok: true, problemas: [] });
});

test('evaluarGate: contrato con aviso sin la línea ni integración falla y explica el formato', () => {
  const r = evaluarGate({
    cambios: CONTRATO,
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: { 'docs/integracion/aviso-front.md': '# Aviso\n\nNada que decir.\n' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.problemas.length, 1);
  const p = r.problemas[0];
  assert.ok(p.includes('routes/a.js'), p);
  assert.ok(p.includes('docs/integracion/para-*.md'), p);
  assert.ok(p.includes('Integración: sin impacto — '), p);
});

test('evaluarGate: sin textosAviso solo vale que cambie un documento de integración', () => {
  const r = evaluarGate({ cambios: CONTRATO, flujo: flujoBase(), hoy: HOY, textoEstado: TEXTO_OK });
  assert.equal(r.ok, false);
});

test('evaluarGate: la línea sin motivo no vale', () => {
  for (const linea of ['Integración: sin impacto — ', 'Integración: sin impacto —    ', 'Integración: sin impacto']) {
    const r = evaluarGate({
      cambios: CONTRATO,
      flujo: flujoBase(),
      hoy: HOY,
      textoEstado: TEXTO_OK,
      textosAviso: { 'docs/integracion/aviso-front.md': `# Aviso\n${linea}\n` },
    });
    assert.equal(r.ok, false, JSON.stringify(linea));
  }
});

test('evaluarGate: la línea debe empezar la línea y estar en un aviso que esté en cambios', () => {
  const sangrada = evaluarGate({
    cambios: CONTRATO,
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: { 'docs/integracion/aviso-front.md': `- ${LINEA}\n` },
  });
  assert.equal(sangrada.ok, false);
  const ajeno = evaluarGate({
    cambios: CONTRATO,
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: { 'docs/integracion/aviso-viejo.md': `${LINEA}\n` },
  });
  assert.equal(ajeno.ok, false);
});

test('evaluarGate: sin contrato tocado no se exige integración', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md', 'config/x.js', 'docs/config.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: {},
  });
  assert.deepEqual(r, { ok: true, problemas: [] });
});

test('evaluarGate: sin integracion en flujo.json solo vale la línea y el mensaje lo dice', () => {
  const flujo = flujoBase();
  delete flujo.integracion;
  const sin = evaluarGate({ cambios: [...CONTRATO, 'docs/integracion/para-front.md'], flujo, hoy: HOY, textoEstado: TEXTO_OK });
  assert.equal(sin.ok, false);
  assert.ok(sin.problemas.some((p) => p.includes('integracion') && p.includes('Integración: sin impacto — ')));
  const con = evaluarGate({
    cambios: CONTRATO,
    flujo,
    hoy: HOY,
    textoEstado: TEXTO_OK,
    textosAviso: { 'docs/integracion/aviso-front.md': LINEA },
  });
  assert.deepEqual(con, { ok: true, problemas: [] });
});

test('ejecutar lee del disco el aviso para PR que está en cambios', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-gate-'));
  const original = [console.log, console.error];
  try {
    const git = gitEn(dir);
    git('init', '-q');
    mkdirSync(join(dir, '.claude'));
    const flujo = {
      ...flujoBase(),
      guias: [],
      verificacion: {},
      specsDir: 'docs/specs',
      maxVueltas: 1,
      consultor: 'ninguno',
      estilo: 'ninguno',
      perfiles: ['base'],
    };
    writeFileSync(join(dir, '.claude', 'flujo.json'), JSON.stringify(flujo));
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');
    for (const d of ['docs/integracion', 'routes']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, 'docs', 'estado.md'), `actualizado ${fechaHoy()}\n`);
    writeFileSync(join(dir, 'routes', 'a.js'), 'x');
    writeFileSync(join(dir, 'docs', 'api.md'), 'x');
    writeFileSync(join(dir, 'docs', 'integracion', 'aviso-front.md'), '# Aviso\n');
    console.log = () => {};
    console.error = () => {};
    assert.equal(ejecutar(['--raiz', dir]), 1);
    writeFileSync(join(dir, 'docs', 'integracion', 'aviso-front.md'), `# Aviso\n\n${LINEA}\n`);
    assert.equal(ejecutar(['--raiz', dir]), 0);
  } finally {
    [console.log, console.error] = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluarGate: solo documentos más estado es ok', () => {
  const r = evaluarGate({
    cambios: ['docs/estado.md', 'docs/otro.md'],
    flujo: flujoBase(),
    hoy: HOY,
    textoEstado: TEXTO_OK,
  });
  assert.deepEqual(r, { ok: true, problemas: [] });
});

test('cambiosGit: sin seguimiento, espacios, borrados y renombrados', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-gate-'));
  try {
    const git = gitEn(dir);
    git('init', '-q');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'borrar.js'), 'x');
    writeFileSync(join(dir, 'viejo.js'), 'contenido que se conserva al renombrar');
    writeFileSync(join(dir, 'sub', 'dejar.js'), 'y');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');
    writeFileSync(join(dir, 'nuevo.js'), 'n');
    writeFileSync(join(dir, 'sub', 'con espacios.js'), 'e');
    rmSync(join(dir, 'borrar.js'));
    git('mv', 'viejo.js', 'nuevo-nombre.js');
    const cambios = cambiosGit(dir);
    for (const esperado of ['nuevo.js', 'sub/con espacios.js', 'borrar.js', 'viejo.js', 'nuevo-nombre.js']) {
      assert.ok(cambios.includes(esperado), `falta ${esperado} en ${JSON.stringify(cambios)}`);
    }
    assert.ok(!cambios.includes('sub/dejar.js'));
    assert.equal(new Set(cambios).size, cambios.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ejecutar --solo-validar sin flujo.json devuelve 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-gate-'));
  try {
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(ejecutar(['--solo-validar', '--raiz', dir]), 1);
    } finally {
      console.error = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
