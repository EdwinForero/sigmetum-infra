import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const ESPERADO = {
  requirements: { model: 'sonnet', effort: 'medium' },
  architect: { model: 'opus', effort: 'high' },
  developer: { model: 'sonnet', effort: 'medium' },
  'tester-documentador': { model: 'sonnet', effort: 'medium' },
};

const MODELOS_VALIDOS = ['sonnet', 'opus', 'haiku', 'fable'];
const ESFUERZOS_VALIDOS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CAMPOS_ADMITIDOS = ['name', 'description', 'tools', 'skills', 'model', 'effort'];
const CAMPOS_IGNORADOS = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];

const GIT_BASE = 'no hace commit, ni push, ni `git add`';
const GIT_DEVELOPER = '`git stash`, `git checkout`, `git restore`, `git reset` ni `git clean`';

// Separa el frontmatter (entre las dos primeras líneas "---") del cuerpo
function leerAgente(nombre) {
  const texto = readFileSync(join(raiz, 'agents', `${nombre}.md`), 'utf8').replace(/\r\n/g, '\n');
  const partes = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(texto);
  assert.ok(partes, `${nombre}.md no tiene frontmatter`);
  return { cabecera: partes[1], cuerpo: partes[2] };
}

const leerCiclo = () =>
  readFileSync(join(raiz, 'commands', 'ciclo.md'), 'utf8').replace(/\r\n/g, '\n');

// Texto de una sección "## Título" hasta la siguiente "## "
const seccion = (texto, titulo) => {
  const inicio = texto.indexOf(`${titulo}\n`);
  if (inicio === -1) return '';
  const resto = texto.slice(inicio + titulo.length + 1);
  const fin = resto.search(/^## /m);
  return fin === -1 ? resto : resto.slice(0, fin);
};

// Claves de primer nivel del frontmatter (las líneas "  - x" empiezan por espacio y no cuentan)
const claves = (cabecera) =>
  cabecera
    .split('\n')
    .map((l) => /^([A-Za-z][A-Za-z0-9_-]*):/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);

const valor = (cabecera, nombre) => {
  const m = new RegExp(`^${nombre}:[ \\t]*(.*)$`, 'm').exec(cabecera);
  return m ? m[1].trim() : undefined;
};

// Lista los problemas de una cabecera de agente (función pura, probada con cabeceras falsas)
function problemasCabecera(cabecera) {
  const problemas = [];
  const ks = claves(cabecera);
  for (const obligado of ['model', 'effort']) {
    if (!ks.includes(obligado)) problemas.push(`falta ${obligado}`);
  }
  for (const k of new Set(ks)) {
    if (ks.filter((x) => x === k).length > 1) problemas.push(`campo repetido: ${k}`);
    if (CAMPOS_ADMITIDOS.includes(k)) continue;
    problemas.push(
      CAMPOS_IGNORADOS.includes(k)
        ? `campo ${k}: se ignora en plugins`
        : `campo desconocido: ${k}`,
    );
  }
  const modelo = valor(cabecera, 'model');
  if (modelo !== undefined && !MODELOS_VALIDOS.includes(modelo)) {
    problemas.push(`model no válido: ${modelo}`);
  }
  const esfuerzo = valor(cabecera, 'effort');
  if (esfuerzo !== undefined && !ESFUERZOS_VALIDOS.includes(esfuerzo)) {
    problemas.push(`effort no válido: ${esfuerzo}`);
  }
  return problemas;
}

// Parte A: frontmatter de los roles

for (const [nombre, esperado] of Object.entries(ESPERADO)) {
  test(`${nombre}: model y effort exactos de la tabla`, () => {
    const { cabecera } = leerAgente(nombre);
    assert.equal(valor(cabecera, 'model'), esperado.model);
    assert.equal(valor(cabecera, 'effort'), esperado.effort);
  });

  test(`${nombre}: frontmatter sin problemas`, () => {
    const { cabecera } = leerAgente(nombre);
    assert.deepEqual(problemasCabecera(cabecera), []);
  });

  test(`${nombre}: claves exactas y principios en skills`, () => {
    const { cabecera } = leerAgente(nombre);
    assert.deepEqual([...claves(cabecera)].sort(), [...CAMPOS_ADMITIDOS].sort());
    assert.ok(
      cabecera.split('\n').some((l) => l.trim() === '- principios'),
      'skills no incluye principios',
    );
  });

  test(`${nombre}: reglas de git intactas`, () => {
    const { cuerpo } = leerAgente(nombre);
    const limites = seccion(cuerpo, '## Límites');
    assert.ok(limites.includes(GIT_BASE), `${nombre}: faltan las reglas de commit`);
    if (nombre === 'developer') {
      assert.ok(limites.includes(GIT_DEVELOPER), 'developer: faltan los comandos git prohibidos');
    }
  });
}

test('problemasCabecera detecta cada cabecera falsa', () => {
  const base = 'name: x\ndescription: y\ntools: Read\nskills:\n  - principios\nmodel: opus\neffort: high';
  assert.deepEqual(problemasCabecera(base), []);
  const falsas = [
    base.replace('effort:', 'efort:'),
    base.replace('model:', 'modle:'),
    `${base}\npermissionMode: plan`,
    `${base}\nhooks:`,
    `${base}\nmcpServers:`,
    `${base}\ninitialPrompt:`,
    base.replace('model: opus', 'model: gpt'),
    base.replace('effort: high', 'effort: ultra'),
    `${base}\nmodel: sonnet`,
  ];
  for (const cabecera of falsas) {
    assert.ok(problemasCabecera(cabecera).length > 0, `no detectó:\n${cabecera}`);
  }
  assert.ok(problemasCabecera(`${base}\nhooks:`).some((p) => p.includes('se ignora en plugins')));
});

// Parte B: reglas de modelos en ciclo.md

test('ciclo.md: regla Modelos y segunda opinión con opus y high en la llamada', () => {
  const reglas = seccion(leerCiclo(), '## Reglas del orquestador');
  for (const frase of [
    '- **Modelos**:',
    'no pasan `model` ni `effort`',
    'la propia llamada',
    'la llamada lleva `model` opus y `effort` high',
  ]) {
    assert.ok(reglas.includes(frase), `las Reglas no incluyen: ${frase}`);
  }
});

test('ciclo.md: regla Fallo repetido con criterio, vuelta y escalado', () => {
  const reglas = seccion(leerCiclo(), '## Reglas del orquestador');
  for (const frase of [
    '- **Fallo repetido**',
    'falla lo mismo',
    'en dos vueltas consecutivas',
    'el texto de la devolución del tester es el mismo',
    'el mismo comando de verificación falla con la misma línea clave',
    'La revisión cuenta como una vuelta y respeta `maxVueltas`',
    'Solo informa: no corrige nada ni hace commit',
    'vuelve a fallar tras la revisión',
  ]) {
    assert.ok(reglas.includes(frase), `las Reglas no incluyen: ${frase}`);
  }
});

test('ciclo.md: el paso 4 invoca la regla Fallo repetido', () => {
  const paso4 = seccion(leerCiclo(), '## Paso 4: verificación y documentación');
  assert.ok(paso4.includes('la regla **Fallo repetido**'));
});

// Parte C: aviso del paso 0

const paso0 = () => seccion(leerCiclo(), '## Paso 0: refresh y comprobaciones');
const VARIABLES = ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL'];

test('ciclo.md: el paso 0 avisa de las variables que anulan la tabla', () => {
  const texto = paso0();
  for (const frase of [
    ...VARIABLES,
    'la tabla de modelos está anulada por <nombre de la variable>',
    'nunca su valor',
    'no bloquea',
  ]) {
    assert.ok(texto.includes(frase), `el paso 0 no incluye: ${frase}`);
  }
});

test('ciclo.md: el comando del aviso solo imprime el nombre de la variable', () => {
  const m = /node -e "([^"]+)"/.exec(paso0());
  assert.ok(m, 'el paso 0 no trae el comando node -e');
  const orden = m[1];
  assert.ok(orden.includes('console.log(n)'));
  assert.ok(!orden.includes('process.env['));
  for (const nombre of VARIABLES) assert.ok(orden.includes(nombre));
});

test('ciclo.md: las variables se mencionan en un único punto, el 6, tras el del grafo', () => {
  const puntos = paso0()
    .split('\n')
    .filter((l) => /^\d+\. /.test(l));
  const con = puntos.filter((p) => VARIABLES.some((v) => p.includes(v)));
  assert.equal(con.length, 1);
  assert.ok(con[0].startsWith('6. '));
  assert.ok(puntos[4].startsWith('5. Grafo'));
  assert.equal(puntos.indexOf(con[0]), 5);
});
