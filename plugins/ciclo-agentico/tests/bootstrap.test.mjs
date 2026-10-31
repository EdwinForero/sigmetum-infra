import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parsearLista,
  parsearListaJson,
  planificar,
  planificarLocales,
  main,
  argumentoSeguro,
  crearEjecutor,
  leerCatalogo,
} from '../scripts/bootstrap-agentes.mjs';

const raizPlugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogo = JSON.parse(
  readFileSync(join(raizPlugin, '.claude-plugin', 'dependencias.json'), 'utf8'),
).dependencias;

const MUESTRA = `Installed plugins:

  ❯ context7@claude-plugins-official
    Version: f8c5e7a1dcb7
    Scope: user
    Status: ✔ enabled

  ❯ diagram-design@diagram-design
    Version: 2.6.46
    Scope: user
    Status: ✔ enabled

  ❯ humanizer@humanizer
    Version: 3.1.0
    Scope: user
    Status: ✔ enabled

  ❯ humanizer@humanizer
    Version: 3.1.0
    Scope: project
    Status: ✔ enabled
`;

// Todos los ids del catálogo real (las pruebas de abajo dependen de que estén superpowers, i-have-adhd, octo e impeccable)
const TODOS = catalogo.map((d) => d.id);

const listaDe = (ids) => `Installed plugins:\n\n${ids.map((id) => `  ❯ ${id}\n    Version: 1.0.0\n    Scope: user\n`).join('\n')}`;
const jsonDe = (ids, version = '1.0.0') =>
  JSON.stringify(ids.map((id) => ({ id, version, scope: 'user', enabled: true, installPath: `/c/${id}` })));
const responder = (args, ids) => (args.includes('--json') ? jsonDe(ids) : listaDe(ids));

// Forma real de "claude plugin list --json": campos extra, duplicados por ámbito y un plugin deshabilitado
const MUESTRA_JSON = JSON.stringify([
  {
    id: 'context7@claude-plugins-official',
    version: 'f8c5e7a1dcb7',
    scope: 'user',
    enabled: true,
    installPath: 'C:\\Users\\x\\.claude\\plugins\\cache\\context7',
    installedAt: '2026-09-30T16:25:21.729Z',
    mcpServers: { context7: { type: 'http', url: 'https://example.invalid/mcp' } },
    projectEnabled: false,
  },
  {
    id: 'frontend-design@claude-plugins-official',
    version: '1.1.1',
    scope: 'user',
    enabled: false,
    installPath: 'C:\\a',
  },
  {
    id: 'frontend-design@claude-plugins-official',
    version: 'd182ca456ca0',
    scope: 'project',
    enabled: true,
    installPath: 'C:\\b',
    projectPath: 'c:\\proyecto',
  },
  { id: 'humanizer@humanizer', version: '3.1.0', scope: 'user', enabled: false, installPath: 'C:\\c' },
]);

// Doble de ejecutar: nunca toca el sistema; registra las llamadas
function doble(ids, { falla = null } = {}) {
  const llamadas = [];
  const ejecutar = (cmd, args) => {
    llamadas.push([cmd, ...args]);
    if (falla) throw falla;
    return responder(args, ids);
  };
  return { ejecutar, llamadas };
}
const instalaciones = (llamadas) => llamadas.filter((l) => l[2] === 'install' || l[2] === 'marketplace');
const callar = (fn) => {
  const original = [console.log, console.error];
  const salida = [];
  console.log = (...a) => salida.push(a.join(' '));
  console.error = (...a) => salida.push(a.join(' '));
  try {
    return { resultado: fn(), salida: salida.join('\n') };
  } finally {
    [console.log, console.error] = original;
  }
};
const raizSinFlujo = () => mkdtempSync(join(tmpdir(), 'bootstrap-'));

test('parsearLista devuelve ids únicos de las líneas con ❯', () => {
  assert.deepEqual(parsearLista(MUESTRA), [
    'context7@claude-plugins-official',
    'diagram-design@diagram-design',
    'humanizer@humanizer',
  ]);
});

test('parsearLista acepta también ">" al inicio de línea (salida fuera de una terminal)', () => {
  const texto = 'Installed plugins:\n\n  > context7@claude-plugins-official\n    Version: 1\n\n> humanizer@humanizer\n';
  assert.deepEqual(parsearLista(texto), ['context7@claude-plugins-official', 'humanizer@humanizer']);
});

test('parsearListaJson devuelve ids únicos y conserva el primero habilitado si se repite por ámbito', () => {
  assert.deepEqual(parsearListaJson(MUESTRA_JSON), [
    { id: 'context7@claude-plugins-official', version: 'f8c5e7a1dcb7', enabled: true },
    { id: 'frontend-design@claude-plugins-official', version: 'd182ca456ca0', enabled: true },
    { id: 'humanizer@humanizer', version: '3.1.0', enabled: false },
  ]);
});

test('parsearListaJson lanza si el texto no es una lista JSON', () => {
  assert.throws(() => parsearListaJson(MUESTRA));
  assert.throws(() => parsearListaJson('{"id":"x@y"}'));
});

test('main usa "plugin list --json" y planifica con sus ids', () => {
  const { ejecutar, llamadas } = doble(TODOS);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--dry-run', '--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.deepEqual(llamadas[0], ['claude', 'plugin', 'list', '--json']);
  assert.match(salida, /Todas las dependencias aplicables están instaladas/);
});

test('main: si la salida JSON no se puede analizar cae al texto (con ">")', () => {
  const llamadas = [];
  const ejecutar = (cmd, args) => {
    llamadas.push([cmd, ...args]);
    return `Installed plugins:\n\n${TODOS.map((id) => `  > ${id}\n    Version: 1.0.0\n`).join('\n')}`;
  };
  const { resultado, salida } = callar(() =>
    main({ argv: ['--dry-run', '--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /Todas las dependencias aplicables están instaladas/);
  assert.ok(llamadas.some((l) => l.join(' ') === 'claude plugin list'));
});

test('main avisa (sin bloquear) si la versión instalada difiere de la revisada', () => {
  const ejecutar = () =>
    JSON.stringify(
      TODOS.map((id) => ({ id, version: id === 'i-have-adhd@i-have-adhd' ? '0.5.0' : '0.4.1', enabled: true })),
    );
  const { resultado, salida } = callar(() =>
    main({ argv: ['--dry-run', '--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /i-have-adhd@i-have-adhd/);
  assert.match(salida, /0\.5\.0/);
  assert.match(salida, /0\.4\.1/);
});

test('main no avisa de versión si coincide con la revisada', () => {
  const versiones = { 'i-have-adhd@i-have-adhd': '0.4.1', 'octo@nyldn-plugins': '11.15.1' };
  const ejecutar = () => JSON.stringify(TODOS.map((id) => ({ id, version: versiones[id] ?? '9.9.9', enabled: true })));
  const { salida } = callar(() =>
    main({ argv: ['--dry-run', '--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.doesNotMatch(salida, /[Vv]ersión/);
});

test('planificar con perfiles base y backend omite impeccable', () => {
  const { faltantes, omitidos } = planificar({
    catalogo,
    perfiles: ['base', 'backend'],
    instalados: [],
    plataforma: 'linux',
  });
  assert.ok(!faltantes.some((d) => d.id.startsWith('impeccable')));
  assert.ok(!omitidos.some((o) => o.dep.id.startsWith('impeccable')));
  assert.ok(faltantes.some((d) => d.id === 'octo@nyldn-plugins'));
});

test('planificar con perfil frontend incluye impeccable', () => {
  const { faltantes } = planificar({
    catalogo,
    perfiles: ['base', 'frontend'],
    instalados: [],
    plataforma: 'linux',
  });
  assert.ok(faltantes.some((d) => d.id === 'impeccable@impeccable'));
});

test('planificar en win32 omite Octopus con motivo que menciona Windows y WSL', () => {
  const { faltantes, omitidos } = planificar({
    catalogo,
    perfiles: ['base'],
    instalados: [],
    plataforma: 'win32',
  });
  const octo = omitidos.find((o) => o.dep.id === 'octo@nyldn-plugins');
  assert.ok(octo);
  assert.match(octo.motivo, /Windows/);
  assert.match(octo.motivo, /WSL/);
  assert.ok(!faltantes.some((d) => d.id === 'octo@nyldn-plugins'));
});

test('planificar con todo instalado no deja faltantes', () => {
  const { faltantes } = planificar({
    catalogo,
    perfiles: ['base', 'frontend'],
    instalados: TODOS,
    plataforma: 'linux',
  });
  assert.deepEqual(faltantes, []);
});

test('main devuelve 2 si claude no existe, avisa y no instala', () => {
  const { ejecutar, llamadas } = doble([], { falla: Object.assign(new Error('x'), { code: 'ENOENT' }) });
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 2);
  assert.match(salida, /claude/);
  assert.deepEqual(llamadas, [['claude', 'plugin', 'list', '--json']]);
});

test('main devuelve 2 si claude plugin list falla por otro motivo', () => {
  const { ejecutar, llamadas } = doble([], { falla: new Error('formato roto') });
  const { resultado } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 2);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main con --dry-run no pregunta ni instala', () => {
  const { ejecutar, llamadas } = doble([]);
  let preguntas = 0;
  const { resultado } = callar(() =>
    main({
      argv: ['--dry-run', '--raiz', raizSinFlujo()],
      ejecutar,
      preguntar: () => {
        preguntas++;
        return true;
      },
      plataforma: 'linux',
    }),
  );
  assert.equal(resultado, 0);
  assert.equal(preguntas, 0);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main sin flujo.json avisa y usa el perfil base', () => {
  const { ejecutar } = doble(TODOS.filter((id) => !id.startsWith('impeccable')));
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /flujo\.json/);
});

test('main: si el usuario rechaza un opcional no instala y devuelve 0', () => {
  const instaladosBase = ['superpowers@superpowers-marketplace', 'understand-anything@understand-anything'];
  const { ejecutar, llamadas } = doble(instaladosBase);
  const { resultado } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => false, plataforma: 'win32' }),
  );
  assert.equal(resultado, 0);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main: instala un faltante con los comandos exactos y verifica', () => {
  const sinAdhd = TODOS.filter((id) => !id.startsWith('i-have-adhd') && !id.startsWith('impeccable'));
  const llamadas = [];
  let instalado = false;
  const ejecutar = (cmd, args) => {
    llamadas.push([cmd, ...args]);
    if (args[1] === 'install') instalado = true;
    return responder(args, instalado ? [...sinAdhd, 'i-have-adhd@i-have-adhd'] : sinAdhd);
  };
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.deepEqual(instalaciones(llamadas), [
    ['claude', 'plugin', 'marketplace', 'add', 'ayghri/i-have-adhd'],
    ['claude', 'plugin', 'install', 'i-have-adhd@i-have-adhd'],
  ]);
  assert.match(salida, /0\.4\.1/);
  assert.match(salida, /rama principal/);
});

test('main devuelve 1 si tras ejecutar queda sin instalar una dependencia base', () => {
  const { ejecutar } = doble([]);
  const { resultado } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 1);
});

test('argumentoSeguro acepta valores del catálogo y rechaza metacaracteres', () => {
  for (const ok of [
    'obra/superpowers-marketplace',
    'superpowers@superpowers-marketplace',
    'https://github.com/nyldn/claude-octopus.git',
  ]) {
    assert.equal(argumentoSeguro(ok), true, ok);
  }
  for (const mal of ['x & calc', 'a|b', 'x"y', 'a b', 'a\nb', '', '--flag', '-x']) {
    assert.equal(argumentoSeguro(mal), false, JSON.stringify(mal));
  }
});

test('crearEjecutor en linux no reintenta tras ENOENT', () => {
  const llamadas = [];
  const execFile = (cmd, args) => {
    llamadas.push([cmd, ...args]);
    throw Object.assign(new Error('x'), { code: 'ENOENT' });
  };
  const ejecutar = crearEjecutor({ plataforma: 'linux', execFile });
  assert.throws(() => ejecutar('claude', ['plugin', 'list']), { code: 'ENOENT' });
  assert.deepEqual(llamadas, [['claude', 'plugin', 'list']]);
});

test('crearEjecutor en win32 con ENOENT reintenta claude.cmd vía cmd.exe', () => {
  const llamadas = [];
  const execFile = (cmd, args, opciones) => {
    llamadas.push([cmd, ...args]);
    assert.equal(opciones.shell, false);
    if (cmd === 'claude') throw Object.assign(new Error('x'), { code: 'ENOENT' });
    return 'ok';
  };
  const ejecutar = crearEjecutor({ plataforma: 'win32', execFile });
  assert.equal(ejecutar('claude', ['plugin', 'list']), 'ok');
  assert.deepEqual(llamadas, [
    ['claude', 'plugin', 'list'],
    ['cmd.exe', '/d', '/s', '/c', 'claude.cmd', 'plugin', 'list'],
  ]);
});

test('crearEjecutor lanza sin ejecutar nada si un argumento es inseguro', () => {
  let llamadas = 0;
  const ejecutar = crearEjecutor({ plataforma: 'win32', execFile: () => llamadas++ });
  assert.throws(() => ejecutar('claude', ['plugin', 'install', 'x & calc']), /x & calc/);
  assert.equal(llamadas, 0);
});

test('main devuelve 2 con un catálogo cuyo id es inseguro, sin instalar', () => {
  const ruta = join(raizSinFlujo(), 'dependencias.json');
  writeFileSync(
    ruta,
    JSON.stringify({ dependencias: [{ id: 'x & calc', rol: 'base', perfil: 'base', marketplace: 'a/b' }] }),
  );
  const { ejecutar, llamadas } = doble([]);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux', rutaCatalogo: ruta }),
  );
  assert.equal(resultado, 2);
  assert.match(salida, /x & calc/);
  assert.match(salida, /"id"/);
  assert.deepEqual(llamadas, []);
});

test('main devuelve 2 con JSON roto y el mensaje incluye la ruta', () => {
  const ruta = join(raizSinFlujo(), 'dependencias.json');
  writeFileSync(ruta, '{ no es json');
  const { ejecutar, llamadas } = doble([]);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizSinFlujo()], ejecutar, preguntar: () => true, plataforma: 'linux', rutaCatalogo: ruta }),
  );
  assert.equal(resultado, 2);
  assert.ok(salida.includes(ruta));
  assert.deepEqual(llamadas, []);
});

test('leerCatalogo acepta un BOM UTF-8 inicial', () => {
  const ruta = join(raizSinFlujo(), 'dependencias.json');
  writeFileSync(
    ruta,
    String.fromCharCode(0xfeff) + JSON.stringify({ dependencias: [{ id: 'a@b', rol: 'base', perfil: 'base', marketplace: 'a/b' }] }),
  );
  assert.deepEqual(leerCatalogo(ruta).map((d) => d.id), ['a@b']);
});

// --- Plugins del marketplace local (campo opcional marketplaceLocal de flujo.json) ---

const MERCADO_LOCAL = {
  name: 'locales',
  owner: { name: 'x' },
  plugins: [
    { name: 'nucleo', source: './nucleo', tags: ['perfil:base'] },
    { name: 'general', source: './general', tags: ['perfil:backend'] },
    { name: 'dominio-a', source: './dominio-a', tags: ['perfil:dominio-a'] },
    { name: 'sin-tags', source: './sin-tags' },
  ],
};

test('planificarLocales elige los plugins de los perfiles activos que no están instalados', () => {
  assert.deepEqual(
    planificarLocales({ marketplace: MERCADO_LOCAL, perfiles: ['base', 'backend'], instalados: ['nucleo@locales'] }),
    { nombreMarketplace: 'locales', faltantes: ['general@locales'] },
  );
});

test('planificarLocales sin perfiles coincidentes o con todo instalado no deja faltantes', () => {
  assert.deepEqual(planificarLocales({ marketplace: MERCADO_LOCAL, perfiles: ['frontend'], instalados: [] }).faltantes, []);
  assert.deepEqual(
    planificarLocales({
      marketplace: MERCADO_LOCAL,
      perfiles: ['base', 'backend', 'dominio-a'],
      instalados: ['nucleo@locales', 'general@locales', 'dominio-a@locales'],
    }).faltantes,
    [],
  );
});

// Raíz temporal con un flujo.json válido y, si se pide, el marketplace local
function raizConLocal({ marketplaceLocal = 'plugins', mercado = MERCADO_LOCAL, perfiles = ['base', 'backend'] } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'bootstrap-local-'));
  mkdirSync(join(raiz, '.claude'));
  const flujo = JSON.parse(readFileSync(join(raizPlugin, 'templates', 'flujo.json'), 'utf8'));
  flujo.perfiles = perfiles;
  if (marketplaceLocal === null) delete flujo.marketplaceLocal;
  else flujo.marketplaceLocal = marketplaceLocal;
  writeFileSync(join(raiz, '.claude', 'flujo.json'), JSON.stringify(flujo));
  if (marketplaceLocal && mercado) {
    mkdirSync(join(raiz, marketplaceLocal, '.claude-plugin'), { recursive: true });
    const texto = typeof mercado === 'string' ? mercado : JSON.stringify(mercado);
    writeFileSync(join(raiz, marketplaceLocal, '.claude-plugin', 'marketplace.json'), String.fromCharCode(0xfeff) + texto);
  }
  return raiz;
}
const EXTERNOS_BASE = catalogo.filter((d) => d.perfil === 'base').map((d) => d.id);

test('main --dry-run lista los plugins locales faltantes con [local] y no ejecuta nada más que list', () => {
  const { ejecutar, llamadas } = doble([...EXTERNOS_BASE, 'nucleo@locales']);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--dry-run', '--raiz', raizConLocal()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /^- general@locales \[local\]$/m);
  assert.doesNotMatch(salida, /nucleo@locales \[local\]/);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main sin marketplaceLocal no hace nada con plugins locales', () => {
  const { ejecutar, llamadas } = doble(EXTERNOS_BASE);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizConLocal({ marketplaceLocal: null })], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.doesNotMatch(salida, /\[local\]|locales/);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main añade el marketplace local una vez, instala cada faltante en la raíz y reverifica', () => {
  const llamadas = [];
  const opciones = [];
  const instalados = new Set(EXTERNOS_BASE);
  const ejecutar = (cmd, args, extra) => {
    llamadas.push([cmd, ...args]);
    opciones.push(extra);
    if (args[1] === 'install') instalados.add(args[2]);
    return responder(args, [...instalados]);
  };
  const raiz = raizConLocal({ perfiles: ['base', 'backend', 'dominio-a'] });
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raiz], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.deepEqual(instalaciones(llamadas), [
    ['claude', 'plugin', 'marketplace', 'add', './plugins'],
    ['claude', 'plugin', 'install', 'nucleo@locales'],
    ['claude', 'plugin', 'install', 'general@locales'],
    ['claude', 'plugin', 'install', 'dominio-a@locales'],
  ]);
  const iAdd = llamadas.findIndex((l) => l[2] === 'marketplace');
  assert.deepEqual(opciones[iAdd], { cwd: raiz });
  assert.match(salida, /Instalado: general@locales/);
  assert.deepEqual(llamadas.at(-1).slice(0, 3), ['claude', 'plugin', 'list']);
});

test('main: si el usuario rechaza los plugins locales no los instala y devuelve 0', () => {
  const { ejecutar, llamadas } = doble(EXTERNOS_BASE);
  const { resultado } = callar(() =>
    main({ argv: ['--raiz', raizConLocal()], ejecutar, preguntar: () => false, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main: un plugin local que sigue sin instalarse no cambia el código de salida', () => {
  const { ejecutar } = doble(EXTERNOS_BASE);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizConLocal()], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /Sin instalar: general@locales/);
});

test('main: un id local inseguro se rechaza sin instalar nada local', () => {
  const mercado = { ...MERCADO_LOCAL, plugins: [{ name: 'x & calc', source: './x', tags: ['perfil:base'] }] };
  const { ejecutar, llamadas } = doble(EXTERNOS_BASE);
  const { resultado, salida } = callar(() =>
    main({ argv: ['--raiz', raizConLocal({ mercado })], ejecutar, preguntar: () => true, plataforma: 'linux' }),
  );
  assert.equal(resultado, 0);
  assert.match(salida, /x & calc/);
  assert.deepEqual(instalaciones(llamadas), []);
});

test('main: si el marketplace local no existe o no es JSON avisa y no cambia el código de salida', () => {
  for (const raiz of [raizConLocal({ mercado: null }), raizConLocal({ mercado: '{ roto' })]) {
    const { ejecutar, llamadas } = doble(EXTERNOS_BASE);
    const { resultado, salida } = callar(() =>
      main({ argv: ['--raiz', raiz], ejecutar, preguntar: () => true, plataforma: 'linux' }),
    );
    assert.equal(resultado, 0);
    assert.match(salida, /marketplace\.json/);
    assert.deepEqual(instalaciones(llamadas), []);
  }
});

test('crearEjecutor pasa el directorio de trabajo pedido', () => {
  let recibidas;
  const ejecutar = crearEjecutor({ plataforma: 'linux', execFile: (cmd, args, o) => (recibidas = o) });
  ejecutar('claude', ['plugin', 'list'], { cwd: '/tmp/x' });
  assert.equal(recibidas.cwd, '/tmp/x');
  assert.equal(recibidas.shell, false);
});
