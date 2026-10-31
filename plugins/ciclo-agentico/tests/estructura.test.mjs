import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validarFlujo } from '../scripts/lib/flujo.mjs';
import { leerJson } from '../scripts/lib/util.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const herramientas = {
  requirements: 'Read, Grep, Glob, Write',
  architect: 'Read, Grep, Glob',
  developer: 'Read, Grep, Glob, Edit, Write, Bash',
  'tester-documentador': 'Read, Grep, Glob, Edit, Write, Bash',
};

const secciones = ['## Límites', '## Entrega', '## Contrato de salida'];

// Separa el frontmatter (entre las dos primeras líneas "---") del cuerpo
function leerAgente(nombre) {
  const texto = readFileSync(join(raiz, 'agents', `${nombre}.md`), 'utf8').replace(/\r\n/g, '\n');
  const partes = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(texto);
  assert.ok(partes, `${nombre}.md no tiene frontmatter`);
  return { cabecera: partes[1], cuerpo: partes[2] };
}

const campo = (cabecera, nombre) => {
  const linea = new RegExp(`^${nombre}:[ \\t]*(.*)$`, 'm').exec(cabecera);
  return linea ? linea[1].trim() : undefined;
};

// Elementos de una lista YAML en bloque ("skills:" seguido de "  - valor")
const lista = (cabecera, nombre) => {
  const bloque = new RegExp(`^${nombre}:[ \\t]*\\n((?:[ \\t]+-[ \\t]*.+\\n?)+)`, 'm').exec(cabecera);
  if (!bloque) return [];
  return bloque[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
};

// Texto de una sección "## Título" hasta la siguiente "## "
const seccion = (cuerpo, titulo) => {
  const inicio = cuerpo.indexOf(`${titulo}\n`);
  if (inicio === -1) return '';
  const resto = cuerpo.slice(inicio + titulo.length + 1);
  const fin = resto.search(/^## /m);
  return fin === -1 ? resto : resto.slice(0, fin);
};

for (const [nombre, esperadas] of Object.entries(herramientas)) {
  test(`${nombre}: frontmatter con nombre, descripción, herramientas y skills`, () => {
    const { cabecera } = leerAgente(nombre);
    assert.equal(campo(cabecera, 'name'), nombre);
    assert.ok(campo(cabecera, 'description'), 'falta la descripción');
    assert.equal(campo(cabecera, 'tools'), esperadas);
    assert.ok(lista(cabecera, 'skills').includes('principios'), 'skills no incluye principios');
  });

  test(`${nombre}: secciones obligatorias y regla de commit`, () => {
    const { cuerpo } = leerAgente(nombre);
    for (const titulo of secciones) {
      assert.match(cuerpo, new RegExp(`^${titulo}$`, 'm'), `falta la sección ${titulo}`);
    }
    assert.ok(seccion(cuerpo, '## Límites').includes('no hace commit'), 'falta "no hace commit" en Límites');
  });

  test(`${nombre}: el contrato de salida remite a la skill principios sin repetir las reglas comunes`, () => {
    const contrato = seccion(leerAgente(nombre).cuerpo, '## Contrato de salida');
    assert.ok(contrato.includes('Aplica el contrato de salida de la skill `principios`'), 'no remite a principios');
    for (const regla of REGLAS_CONTRATO) {
      assert.ok(!contrato.includes(regla), `repite la regla común: ${regla}`);
    }
  });
}

// Reglas comunes del contrato de salida: viven solo en skills/principios/SKILL.md
const REGLAS_CONTRATO = [
  'nada de preámbulo, recapitulación ni cortesías',
  'Una línea con el estado actual',
  'Listas de máximo 5 elementos: agrupa y prioriza si hay más.',
  'Termina con un único siguiente paso concreto.',
];

test('principios: tiene la sección Contrato de salida con las reglas comunes', () => {
  const contrato = seccion(leerTexto('skills', 'principios', 'SKILL.md'), '## Contrato de salida');
  for (const regla of REGLAS_CONTRATO) {
    assert.ok(contrato.includes(regla), `principios no incluye: ${regla}`);
  }
});

test('requirements y architect no reciben Bash', () => {
  for (const nombre of ['requirements', 'architect']) {
    const herr = campo(leerAgente(nombre).cabecera, 'tools').split(',').map((h) => h.trim());
    assert.ok(!herr.includes('Bash'), `${nombre} no debe tener Bash`);
  }
});

test('tester-documentador: "preexistente" nunca aplica al cierre documental', () => {
  const { cuerpo } = leerAgente('tester-documentador');
  assert.ok(cuerpo.includes('Preexistente'), 'falta la regla de fallos preexistentes');
  assert.ok(
    cuerpo.includes('"Preexistente" nunca se aplica a `docs-gate`, a las comprobaciones de documentación ni al contenido del documento `estado`.'),
    'falta la frase de que preexistente nunca aplica a docs-gate',
  );
});

test('developer: Límites prohíbe docsObligatorios, integracion y specsDir', () => {
  const limites = seccion(leerAgente('developer').cuerpo, '## Límites');
  for (const campoFlujo of ['docsObligatorios', 'integracion', 'specsDir']) {
    assert.ok(limites.includes(`\`${campoFlujo}\``), `Límites no menciona ${campoFlujo}`);
  }
});

test('tester-documentador: se detiene sin tocar documentos si hay algo que devolver', () => {
  const { cuerpo } = leerAgente('tester-documentador');
  assert.ok(
    cuerpo.includes('Si hay algo que devolver al `developer`, te detienes aquí: no editas ningún documento (tampoco `estado`), no ejecutas las entradas de documentación y entregas solo la devolución.'),
    'falta la regla de detenerse',
  );
});

test('tester-documentador: separa criterios de código y de documentación', () => {
  const { cuerpo } = leerAgente('tester-documentador');
  assert.ok(
    cuerpo.includes('Separa los criterios de aceptación de la spec en **de código** (comportamiento, pruebas) y **de documentación** (lo que debe decir un documento).'),
    'falta la separación de criterios',
  );
  assert.ok(cuerpo.includes('ningún criterio de código falla'), 'la condición de avance no se limita a criterios de código');
  assert.ok(
    cuerpo.includes('Un criterio de documentación que falle se trata como documentación en rojo.'),
    'falta el tratamiento de criterios de documentación',
  );
  const entrega = seccion(cuerpo, '## Entrega');
  assert.ok(entrega.includes('Criterios de aceptación de código y de documentación'), 'la Entrega no informa ambos grupos');
});

test('tester-documentador: la Entrega de la parada menciona los preexistentes a escalar', () => {
  const entrega = seccion(leerAgente('tester-documentador').cuerpo, '## Entrega');
  assert.ok(
    entrega.includes('Fallos preexistentes detectados que se escalan al usuario (una línea), aunque haya devolución.'),
    'la Entrega de la parada no menciona los preexistentes',
  );
});

test('developer: Límites prohíbe los archivos de avisoPR', () => {
  const limites = seccion(leerAgente('developer').cuerpo, '## Límites');
  assert.ok(limites.includes('`avisoPR`'), 'Límites no menciona avisoPR');
});

const leerTexto = (...partes) => readFileSync(join(raiz, ...partes), 'utf8').replace(/\r\n/g, '\n');
const plantillaFlujo = leerJson(join(raiz, 'templates', 'flujo.json'));

test('templates/flujo.json pasa validarFlujo', () => {
  assert.deepEqual(validarFlujo(plantillaFlujo), { ok: true, problemas: [] });
});

test('settings-snippet.json desactiva la memoria y pide confirmación para git', () => {
  const ajustes = JSON.parse(leerTexto('templates', 'settings-snippet.json'));
  assert.equal(ajustes.autoMemoryEnabled, false);
  assert.deepEqual(ajustes.permissions?.ask, [
    'Bash(git commit:*)',
    'Bash(git push:*)',
    'Bash(git add:*)',
    'Bash(git stash:*)',
    'PowerShell(git commit *)',
    'PowerShell(git push *)',
    'PowerShell(git add *)',
    'PowerShell(git stash *)',
  ]);
});

test('las plantillas de texto existen', () => {
  for (const nombre of ['CLAUDE-seccion.md', 'spec.md', 'plan.md']) {
    assert.ok(existsSync(join(raiz, 'templates', nombre)), `falta templates/${nombre}`);
  }
});

const cabeceraComando = (texto) => {
  const partes = /^---\n([\s\S]*?)\n---\n/.exec(texto);
  assert.ok(partes, 'el comando no tiene frontmatter');
  return partes[1];
};

test('ciclo.md: frontmatter, pasos 0 a 5 y piezas del orquestador', () => {
  const texto = leerTexto('commands', 'ciclo.md');
  const cabecera = cabeceraComando(texto);
  assert.ok(campo(cabecera, 'description'), 'falta la descripción');
  assert.equal(campo(cabecera, 'argument-hint'), '<tarea>');
  for (let n = 0; n <= 5; n++) {
    assert.match(texto, new RegExp(`^## Paso ${n}\\b`, 'm'), `falta el encabezado del paso ${n}`);
  }
  const piezas = [
    'puerta humana', 'maxVueltas', 'refresh-estado', 'docs-gate', 'bootstrap-agentes', 'criticidad',
    'consultor', 'estilo', 'AskUserQuestion', 'understand-anything:understand-diff',
    'diagram-design:diagram-design', 'El orquestador nunca hace commit',
  ];
  for (const pieza of piezas) {
    assert.ok(texto.includes(pieza), `ciclo.md no menciona ${pieza}`);
  }
});

test('ciclo-init.md: no hace commit y valida con --solo-validar', () => {
  const texto = leerTexto('commands', 'ciclo-init.md');
  assert.ok(campo(cabeceraComando(texto), 'description'), 'falta la descripción');
  assert.ok(texto.includes('no hace commit'), 'falta "no hace commit"');
  assert.ok(texto.includes('--solo-validar'), 'falta --solo-validar');
});

test('refresh-estado: existe con su nombre y solo menciona --auto-update para prohibirlo', () => {
  const ruta = join(raiz, 'skills', 'refresh-estado', 'SKILL.md');
  assert.ok(existsSync(ruta), 'falta skills/refresh-estado/SKILL.md');
  const texto = leerTexto('skills', 'refresh-estado', 'SKILL.md');
  assert.equal(campo(cabeceraComando(texto), 'name'), 'refresh-estado');
  const lineas = texto.split('\n').filter((l) => l.includes('--auto-update'));
  assert.ok(lineas.length > 0, 'no prohíbe --auto-update');
  for (const linea of lineas) {
    assert.match(linea, /nunca[^\n]*--auto-update/i, `--auto-update sin "nunca": ${linea}`);
  }
});

test('templates/flujo.json: verificacion usa la clave test y una regla documental neutra', () => {
  const flujo = plantillaFlujo;
  assert.ok('test' in flujo.verificacion, 'falta la clave test en verificacion');
  assert.ok(!('pruebas' in flujo.verificacion), 'sobra la clave pruebas');
  assert.equal(flujo.docsRegla, 'docs/guias/documentacion.md');
  assert.ok(flujo.$comentario.includes('test'), 'el comentario no explica cuándo existe la clave test');
});

test('ciclo.md: árbol sucio en el paso 0 con tres opciones y sin tratarlo como ajeno', () => {
  const texto = leerTexto('commands', 'ciclo.md');
  for (const frase of [
    'Hacer commit yo y relanzar',
    'Continuación: estos cambios son parte de esta misma iteración',
    'la iteración incluye cambios previos',
  ]) {
    assert.ok(texto.includes(frase), `ciclo.md no incluye: ${frase}`);
  }
  assert.ok(!texto.includes('contarán en `docs-gate`'), 'sigue la opción de seguir con cambios ajenos');
});

test('refresh-estado: spec cerrada sin commit no cuenta como abierta', () => {
  assert.ok(leerTexto('skills', 'refresh-estado', 'SKILL.md').includes('cerrada, pendiente de commit'));
});

test('ciclo.md: preexistentes aceptados, relanzamiento vigilado, reserva solo informativa y límite de la foto', () => {
  const texto = leerTexto('commands', 'ciclo.md');
  for (const frase of [
    'excepto fallos preexistentes que el usuario haya aceptado explícitamente',
    'Mensaje de commit: no propuesto por el tester',
    'envuelto en las mismas fotos de código antes y después (puntos 1 y 3)',
    'git diff HEAD',
    'Solo informa: no se corrige nada',
    'que `/octo:review` acepte un plan',
    'Límite conocido de la foto',
    'Revisar requisitos',
  ]) {
    assert.ok(texto.includes(frase), `ciclo.md no incluye: ${frase}`);
  }
});

test('ciclo.md y ciclo-init.md buscan el plugin en tres sitios por orden', () => {
  for (const nombre of ['ciclo.md', 'ciclo-init.md']) {
    const texto = leerTexto('commands', nombre);
    const posiciones = ['${CLAUDE_PLUGIN_ROOT}', 'plugins/ciclo-agentico/scripts', '~/.claude/plugins/cache'].map((t) => texto.indexOf(t));
    assert.ok(posiciones.every((p) => p !== -1), `${nombre} no nombra los tres sitios`);
    assert.ok(posiciones[0] < posiciones[1] && posiciones[1] < posiciones[2], `${nombre}: orden de búsqueda incorrecto`);
  }
});

test('ciclo-init.md: clave test solo con base de tests y .gitignore del grafo', () => {
  const texto = leerTexto('commands', 'ciclo-init.md');
  assert.ok(texto.includes('omítela si el proyecto no tiene una base de tests real'), 'falta la regla de la clave test');
  assert.ok(texto.includes('`.understand-anything/`') && texto.includes('`.ua/`'), 'falta la propuesta de .gitignore');
});

test('ciclo.md: el paso 0 comprueba el árbol limpio antes de cualquier escritura y el grafo va al final', () => {
  const texto = leerTexto('commands', 'ciclo.md');
  const paso0 = seccion(texto, '## Paso 0: refresh y comprobaciones');
  const orden = [
    'scripts/docs-gate.mjs" --solo-validar',
    'scripts/bootstrap-agentes.mjs" --dry-run',
    'Hacer commit yo y relanzar',
    'Invoca la skill `refresh-estado`',
    'git check-ignore -q .understand-anything/',
  ].map((t) => paso0.indexOf(t));
  assert.ok(orden.every((p) => p !== -1), `faltan textos del paso 0: ${orden}`);
  for (let i = 1; i < orden.length; i++) {
    assert.ok(orden[i - 1] < orden[i], `orden incorrecto en el paso 0 (posición ${i})`);
  }
  for (const frase of ['git ls-files .understand-anything .ua', 'git rm -r --cached', 'sigue sin grafo']) {
    assert.ok(paso0.includes(frase), `el paso 0 no incluye: ${frase}`);
  }
  for (const linea of texto.split('\n').filter((l) => l.includes('--auto-update'))) {
    assert.match(linea, /nunca[^\n]*--auto-update/i, `--auto-update sin "nunca": ${linea}`);
  }
});

test('refresh-estado: solo informa del grafo y avisa con las opciones del paso 0', () => {
  const texto = leerTexto('skills', 'refresh-estado', 'SKILL.md');
  assert.ok(!texto.includes('understand-anything:understand'), 'la skill no debe actualizar el grafo');
  assert.ok(texto.includes('desactualizado'), 'no informa de si el grafo está desactualizado');
  assert.ok(!texto.includes('ajenos a esta tarea'), 'sigue el aviso antiguo de cambios ajenos');
  assert.ok(texto.includes('hacer commit, abandonar o declarar continuación'), 'falta el aviso coherente con el paso 0');
});

test('ciclo-init.md: el commit de sus archivos es necesario antes del primer /ciclo', () => {
  const texto = leerTexto('commands', 'ciclo-init.md');
  assert.ok(!texto.includes('hacer el commit si se quiere'), 'sigue "hacer el commit si se quiere"');
  assert.ok(texto.includes('es necesario antes del primer `/ciclo`'), 'falta que el commit es necesario');
});

test('la regla de carpeta del grafo vive solo en refresh-estado; ciclo.md la invoca y exige ignorar las dos si no hay ninguna', () => {
  const regla = '`.understand-anything/` si existe; si no, `.ua/` si existe; si no existe ninguna, el primer grafo irá a `.ua/`';
  assert.ok(leerTexto('skills', 'refresh-estado', 'SKILL.md').includes(regla), 'refresh-estado no tiene la regla de carpeta');
  const ciclo = leerTexto('commands', 'ciclo.md');
  assert.ok(!ciclo.includes(regla), 'ciclo.md repite la regla de carpeta');
  const paso0 = seccion(ciclo, '## Paso 0: refresh y comprobaciones');
  assert.ok(paso0.includes('Aplica la regla de carpeta del grafo de `refresh-estado`'), 'ciclo.md no invoca la regla de refresh-estado');
  for (const frase of ['git check-ignore -q .ua/', 'hay que ignorar las dos', 'ignorada y sin archivos rastreados']) {
    assert.ok(paso0.includes(frase), `el paso 0 no incluye: ${frase}`);
  }
  assert.ok(!paso0.includes('si es la carpeta que existe'), 'sigue la comprobación antigua de una sola carpeta');
});

test('los pasos de documentación del plan van al tester-documentador, no al developer', () => {
  const architect = leerAgente('architect').cuerpo;
  assert.ok(
    architect.includes('Los pasos que son solo de documentación no van al `developer`: sepáralos en la sección **A cargo del tester-documentador** o conviértelos en criterios de aceptación de documentación.'),
    'architect.md no separa los pasos de documentación',
  );
  assert.ok(leerTexto('templates', 'plan.md').includes('## A cargo del tester-documentador'), 'plan.md no tiene la sección');
  const developer = leerAgente('developer').cuerpo;
  assert.ok(
    seccion(developer, '## Límites').includes('Si un paso del plan es de documentación, lo ignoras sin devolverlo y lo mencionas en tu entrega.'),
    'developer.md no ignora los pasos de documentación',
  );
  assert.ok(
    seccion(developer, '## Entrega').includes('Pasos de documentación ignorados'),
    'la Entrega del developer no menciona los pasos de documentación',
  );
  const paso4 = seccion(leerTexto('commands', 'ciclo.md'), '## Paso 4: verificación y documentación');
  assert.ok(
    paso4.includes('la sección "A cargo del tester-documentador" del plan'),
    'ciclo.md no pasa al tester la sección de documentación del plan',
  );
});

test('ciclo.md: la foto de código vigila todo archivo cambiado que no sea documento', () => {
  const paso4 = seccion(leerTexto('commands', 'ciclo.md'), '## Paso 4: verificación y documentación');
  for (const frase of [
    'todo archivo cambiado que no sea documento',
    'Es documento: extensión `.md`, `.mdx` o `.txt`; el documento `estado`; los `docsObligatorios`; los valores de `docsPorArea`; los de `integracion` y `guias`; lo que esté bajo `specsDir`; y lo que coincida con `avisoPR`.',
    'Límite conocido de la foto: un documento nuevo que no sea `.md`, `.mdx` ni `.txt`',
  ]) {
    assert.ok(paso4.includes(frase), `el paso 4 no incluye: ${frase}`);
  }
  assert.ok(!paso4.includes('solo vigila los archivos que coinciden con claves de `docsPorArea`'), 'sigue el límite antiguo');
});

test('requirements sigue templates/spec.md y ciclo.md le pasa su ruta', () => {
  const cuerpo = leerAgente('requirements').cuerpo;
  for (const frase of [
    'sigue la plantilla de spec cuya ruta te pasa el orquestador (`<plugin>/templates/spec.md`)',
    '`Fecha: AAAA-MM-DD · Estado: borrador`',
    'Si ya existe un archivo con ese nombre, añade un sufijo',
  ]) {
    assert.ok(cuerpo.includes(frase), `requirements.md no incluye: ${frase}`);
  }
  // La estructura vive solo en la plantilla: requirements no repite sus secciones
  for (const seccionSpec of ['**Objetivo**', '**Criterios de aceptación**', '**Fuera de alcance**']) {
    assert.ok(!cuerpo.includes(seccionSpec), `requirements.md repite la sección ${seccionSpec} de la plantilla`);
  }
  const spec = leerTexto('templates', 'spec.md');
  assert.ok(spec.includes('Fecha: AAAA-MM-DD · Estado: borrador'), 'spec.md cambió de cabecera');
  for (const sub of ['### De código', '### De documentación', '## Impacto en contratos externos', '## Preguntas abiertas']) {
    assert.ok(spec.includes(sub), `spec.md no tiene ${sub}`);
  }
  const paso1 = seccion(leerTexto('commands', 'ciclo.md'), '## Paso 1: requisitos y puerta humana');
  assert.ok(paso1.includes('`<plugin>/templates/spec.md`'), 'ciclo.md no pasa la ruta de la plantilla de spec');
  assert.ok(paso1.includes('si ya existe un archivo con ese nombre, añada un sufijo y lo diga'), 'ciclo.md no indica el sufijo');
});

test('architect sigue templates/plan.md, ciclo.md le pasa su ruta y no repite los campos del paso', () => {
  const entrega = seccion(leerAgente('architect').cuerpo, '## Entrega');
  assert.ok(entrega.includes('plantilla de plan cuya ruta te pasa el orquestador (`<plugin>/templates/plan.md`)'), 'architect no remite a plan.md');
  assert.ok(!entrega.includes('Firmas de las funciones'), 'architect repite los campos del paso de la plantilla');
  assert.ok(leerTexto('templates', 'plan.md').includes('Firmas que cambian'), 'plan.md no pide las firmas');
  const paso2 = seccion(leerTexto('commands', 'ciclo.md'), '## Paso 2: arquitectura y puerta humana');
  assert.ok(paso2.includes('`<plugin>/templates/plan.md`'), 'ciclo.md no pasa la ruta de la plantilla de plan al architect');
});

test('refresh-estado: los avisos para PR no cuentan como specs abiertas', () => {
  const texto = leerTexto('skills', 'refresh-estado', 'SKILL.md');
  assert.ok(
    texto.includes('Excluye los archivos que coincidan con `avisoPR`: no llevan `Estado:`.'),
    'refresh-estado no excluye los avisos para PR',
  );
});

test('ciclo-init.md: comprueba dependencias antes de decidir consultor y estilo', () => {
  const texto = leerTexto('commands', 'ciclo-init.md');
  const dependencias = texto.indexOf('scripts/bootstrap-agentes.mjs" --dry-run');
  const decision = texto.indexOf('`consultor` y `estilo`');
  assert.ok(dependencias !== -1 && decision !== -1, 'faltan los textos de dependencias o de consultor y estilo');
  assert.ok(dependencias < decision, 'la comprobación de dependencias va después de decidir consultor y estilo');
  assert.ok(texto.includes('según la salida del paso 1'), 'la decisión no se apoya en la comprobación de dependencias');
});

test('ciclo.md (paso 0) y ciclo-init.md: las líneas [local] informan en una línea, remiten al bootstrap y no bloquean', () => {
  const textos = {
    'ciclo.md': seccion(leerTexto('commands', 'ciclo.md'), '## Paso 0: refresh y comprobaciones'),
    'ciclo-init.md': seccion(leerTexto('commands', 'ciclo-init.md'), '## 1. Dependencias'),
  };
  for (const [nombre, texto] of Object.entries(textos)) {
    for (const frase of [
      'Las líneas `- <id> [local]` son plugins locales del marketplace del proyecto aún no instalados',
      'en una sola línea',
      '`npm run agentes:bootstrap`',
      'no bloquean',
    ]) {
      assert.ok(texto.includes(frase), `${nombre} no incluye: ${frase}`);
    }
  }
});

test('ciclo-init.md menciona cada clave de primer nivel de templates/flujo.json', () => {
  const texto = leerTexto('commands', 'ciclo-init.md');
  const claves = Object.keys(plantillaFlujo).filter((clave) => clave !== '$comentario');
  assert.ok(claves.includes('marketplaceLocal'), 'la plantilla no trae marketplaceLocal');
  for (const clave of claves) {
    assert.ok(texto.includes(`\`${clave}\``), `ciclo-init.md no menciona la clave ${clave}`);
  }
  assert.ok(texto.includes('`marketplaceLocal` es opcional'), 'ciclo-init.md no dice que marketplaceLocal es opcional');
});

test('ciclo.md (paso 5): el aviso para PR es el archivo de avisoPR que cambió en esta iteración', () => {
  const paso5 = seccion(leerTexto('commands', 'ciclo.md'), '## Paso 5: puerta humana final');
  assert.ok(
    paso5.includes('el archivo que coincide con `avisoPR` y que cambió en esta iteración'),
    'el paso 5 no limita el aviso al que cambió en esta iteración',
  );
});

test('la skill principios existe con su nombre', () => {
  const ruta = join(raiz, 'skills', 'principios', 'SKILL.md');
  assert.ok(existsSync(ruta), 'falta skills/principios/SKILL.md');
  const texto = readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
  const cabecera = /^---\n([\s\S]*?)\n---\n/.exec(texto);
  assert.ok(cabecera, 'SKILL.md no tiene frontmatter');
  assert.equal(campo(cabecera[1], 'name'), 'principios');
  assert.ok(campo(cabecera[1], 'description'), 'falta la descripción');
});
