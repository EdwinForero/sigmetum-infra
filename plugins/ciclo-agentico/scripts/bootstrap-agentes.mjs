import { execFileSync } from 'node:child_process';
import { readSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argumentoSeguro, cargarFlujo } from './lib/flujo.mjs';
import { leerJson, quitarBom } from './lib/util.mjs';

export { argumentoSeguro };

const NOMBRES_PLATAFORMA = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

// Respaldo para un CLI sin --json: ids únicos "nombre@marketplace" de las líneas "  ❯ nombre@marketplace".
// Fuera de una terminal el marcador puede salir como ">", así que se aceptan los dos.
export function parsearLista(texto) {
  const ids = new Set();
  for (const linea of String(texto).split(/\r?\n/)) {
    const m = /^\s*[❯>]\s+(\S+@\S+)\s*$/.exec(linea);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

// Salida de "claude plugin list --json": lista de objetos con id, version, scope, enabled y campos extra.
// Un plugin puede repetirse por ámbito: se conserva el primero habilitado (o el primero si ninguno lo está).
// Lanza si el texto no es una lista JSON.
export function parsearListaJson(texto) {
  const lista = JSON.parse(quitarBom(String(texto)));
  if (!Array.isArray(lista)) throw new Error('La salida de "claude plugin list --json" no es una lista');
  const porId = new Map();
  for (const p of lista) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') continue;
    const entrada = {
      id: p.id,
      version: typeof p.version === 'string' ? p.version : null,
      enabled: p.enabled === true,
    };
    const previa = porId.get(p.id);
    if (!previa || (!previa.enabled && entrada.enabled)) porId.set(p.id, entrada);
  }
  return [...porId.values()];
}

export function planificar({ catalogo, perfiles, instalados, plataforma }) {
  const faltantes = [];
  const omitidos = [];
  for (const dep of catalogo) {
    if (!perfiles.includes(dep.perfil) || instalados.includes(dep.id)) continue;
    if (dep.plataformas && !dep.plataformas.includes(plataforma)) {
      const nombre = NOMBRES_PLATAFORMA[plataforma] ?? plataforma;
      const soportadas = dep.plataformas.map((p) => NOMBRES_PLATAFORMA[p] ?? p).join(' y ');
      const sugerencia = plataforma === 'win32' ? ' En Windows puedes usarlo desde WSL.' : '';
      omitidos.push({ dep, motivo: `${dep.id} solo se soporta en ${soportadas}, no en ${nombre}.${sugerencia}` });
      continue;
    }
    faltantes.push(dep);
  }
  return { faltantes, omitidos };
}

// Plugins del marketplace local: ids "plugin@marketplace" de los que llevan el tag "perfil:<p>" de algún
// perfil activo y no están instalados
export function planificarLocales({ marketplace, perfiles, instalados }) {
  const nombreMarketplace = marketplace.name;
  const etiquetas = new Set(perfiles.map((p) => `perfil:${p}`));
  const faltantes = (marketplace.plugins ?? [])
    .filter((p) => Array.isArray(p.tags) && p.tags.some((t) => etiquetas.has(t)))
    .map((p) => `${p.name}@${nombreMarketplace}`)
    .filter((id) => !instalados.includes(id));
  return { nombreMarketplace, faltantes };
}

// En Windows, si "claude" no existe como ejecutable se reintenta con "claude.cmd". Node no ejecuta .cmd
// directamente (EINVAL), así que se lanza vía cmd.exe /c sin la opción shell. Es seguro porque antes de
// tocar nada se validan todos los argumentos con argumentoSeguro: ninguno contiene metacaracteres de cmd.exe.
export function crearEjecutor({ plataforma = process.platform, execFile = execFileSync } = {}) {
  const opciones = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false };
  // extra admite { cwd } para ejecutar en la raíz del proyecto (rutas relativas del marketplace local)
  return function ejecutar(cmd, args, extra = {}) {
    for (const arg of args) {
      if (!argumentoSeguro(arg)) {
        throw new Error(`Argumento no permitido para ejecutar claude: "${arg}"`);
      }
    }
    const conCwd = extra.cwd ? { ...opciones, cwd: extra.cwd } : opciones;
    try {
      return execFile(cmd, args, conCwd);
    } catch (error) {
      if (plataforma === 'win32' && error.code === 'ENOENT' && cmd === 'claude') {
        return execFile('cmd.exe', ['/d', '/s', '/c', 'claude.cmd', ...args], conCwd);
      }
      throw error;
    }
  };
}

function preguntarPorDefecto(texto) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${texto} [s/N] `);
  const buffer = Buffer.alloc(256);
  let respuesta = '';
  while (!respuesta.includes('\n')) {
    let leidos = 0;
    try {
      leidos = readSync(0, buffer, 0, buffer.length, null);
    } catch {
      return false;
    }
    if (leidos === 0) break;
    respuesta += buffer.toString('utf8', 0, leidos);
  }
  return /^\s*(s|si|sí|y|yes)\s*$/i.test(respuesta);
}

function leerArgumentos(argv) {
  const opciones = { raiz: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--raiz' && i + 1 < argv.length) {
      opciones.raiz = argv[++i];
    } else if (argv[i] === '--dry-run') {
      opciones.dryRun = true;
    }
  }
  return opciones;
}

const RUTA_CATALOGO = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'dependencias.json');

// Lanza Error con mensaje en español si el catálogo no es válido
export function leerCatalogo(ruta = RUTA_CATALOGO) {
  let obj;
  try {
    obj = leerJson(ruta);
  } catch (error) {
    throw new Error(`No se pudo leer el catálogo ${ruta}: ${error.message}`);
  }
  if (obj === null || typeof obj !== 'object' || !Array.isArray(obj.dependencias)) {
    throw new Error(`El catálogo ${ruta} debe ser un objeto con la lista "dependencias"`);
  }
  obj.dependencias.forEach((dep, i) => {
    const nombre = dep && typeof dep.id === 'string' ? dep.id : `n.º ${i + 1}`;
    for (const campo of ['id', 'marketplace', 'rol', 'perfil']) {
      if (dep === null || typeof dep !== 'object' || typeof dep[campo] !== 'string') {
        throw new Error(`Catálogo ${ruta}: en la dependencia ${nombre} el campo "${campo}" debe ser un texto`);
      }
    }
    for (const campo of ['id', 'marketplace']) {
      if (!argumentoSeguro(dep[campo])) {
        throw new Error(`Catálogo ${ruta}: en la dependencia ${nombre} el campo "${campo}" tiene un valor no permitido: "${dep[campo]}"`);
      }
    }
  });
  return obj.dependencias;
}

// Devuelve [{ id, version, enabled }]. Si el JSON no se puede analizar (CLI antiguo) o el CLI rechaza
// --json, cae al texto de "claude plugin list" (sin versión). Si no existe claude, propaga ENOENT.
function listarInstalados(ejecutar) {
  try {
    return parsearListaJson(ejecutar('claude', ['plugin', 'list', '--json']));
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
  }
  return parsearLista(ejecutar('claude', ['plugin', 'list'])).map((id) => ({ id, version: null, enabled: true }));
}

// Aviso informativo si la versión instalada no es la revisada en el catálogo
function avisarVersiones(catalogo, instalados) {
  for (const dep of catalogo) {
    if (!dep.revisado || typeof dep.revisado.version !== 'string') continue;
    const inst = instalados.find((p) => p.id === dep.id);
    if (inst && inst.version && inst.version !== dep.revisado.version) {
      console.log(
        `Aviso: ${dep.id} tiene instalada la versión ${inst.version}; la revisada en el catálogo es ${dep.revisado.version}.`,
      );
    }
  }
}

function instalar(dep, ejecutar, preguntar) {
  console.log(`\nInstalar ${dep.id}`);
  console.log(`  Origen: ${dep.marketplace}`);
  if (dep.revisado) console.log(`  Versión revisada: ${dep.revisado.version} (commit ${dep.revisado.commit})`);
  if (dep.porConfirmar) console.log('  Aviso: el id exacto de este plugin está por confirmar; se comprobará tras instalarlo.');
  const comandos = [
    ['plugin', 'marketplace', 'add', dep.marketplace],
    ['plugin', 'install', dep.id],
  ];
  comandos.forEach((c) => console.log(`  Comando: claude ${c.join(' ')}`));
  console.log('  Aviso: "claude plugin marketplace add" sigue la rama principal y no fija la versión revisada (por confirmar).');
  if (!preguntar(`¿Instalar ${dep.id}?`)) {
    console.log('  Omitido por el usuario.');
    return;
  }
  try {
    comandos.forEach((c) => ejecutar('claude', c));
  } catch (error) {
    console.error(`  Falló la instalación de ${dep.id}: ${error.message}`);
  }
}

// Códigos de salida: 0 correcto, 1 falta una dependencia base, 2 no se puede operar
// (sin claude, "plugin list" falla o la entrada es inválida, como un catálogo mal formado)
export function main({
  argv = [],
  ejecutar = crearEjecutor(),
  preguntar = preguntarPorDefecto,
  plataforma = process.platform,
  rutaCatalogo = RUTA_CATALOGO,
} = {}) {
  const { raiz, dryRun } = leerArgumentos(argv);

  const { flujo, problemas } = cargarFlujo(raiz);
  let perfiles = ['base'];
  if (flujo === null) {
    console.log('Aviso: no se pudo usar flujo.json; se usa solo el perfil "base".');
    problemas.forEach((p) => console.log(`  ${p}`));
  } else {
    perfiles = flujo.perfiles;
  }

  let catalogo;
  try {
    catalogo = leerCatalogo(rutaCatalogo);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  let instalados;
  try {
    instalados = listarInstalados(ejecutar);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('No se encontró el comando "claude". Instala Claude Code y vuelve a ejecutar este script.');
    } else {
      console.error(`No se pudo ejecutar "claude plugin list": ${error.message}`);
    }
    return 2;
  }

  avisarVersiones(catalogo, instalados);
  const { faltantes, omitidos } = planificar({
    catalogo,
    perfiles,
    instalados: instalados.map((p) => p.id),
    plataforma,
  });
  omitidos.forEach(({ motivo }) => console.log(`Omitido: ${motivo}`));
  const codigo = instalarExternos({ faltantes, dryRun, ejecutar, preguntar });
  if (codigo === 2) return codigo;

  // Los plugins locales se procesan después; nunca cambian el código de salida
  procesarLocales({ raiz, flujo, perfiles, dryRun, ejecutar, preguntar });
  return codigo;
}

// Dependencias externas del catálogo: 0 correcto, 1 falta una base tras instalar, 2 no se pudo verificar
function instalarExternos({ faltantes, dryRun, ejecutar, preguntar }) {
  if (faltantes.length === 0) {
    console.log('Todas las dependencias aplicables están instaladas.');
    return 0;
  }
  if (dryRun) {
    console.log('Dependencias que faltan (simulación, no se instala nada):');
    faltantes.forEach((d) => console.log(`- ${d.id} [${d.rol}] desde ${d.marketplace}`));
    return 0;
  }

  faltantes.forEach((dep) => instalar(dep, ejecutar, preguntar));

  let despues;
  try {
    despues = listarInstalados(ejecutar);
  } catch (error) {
    console.error(`No se pudo verificar la instalación: ${error.message}`);
    return 2;
  }
  let falta = false;
  for (const dep of faltantes) {
    const ok = despues.some((p) => p.id === dep.id);
    console.log(`${ok ? 'Instalado' : 'Sin instalar'}: ${dep.id}`);
    if (!ok && dep.rol === 'base') falta = true;
  }
  return falta ? 1 : 0;
}

// Lee <raiz>/<marketplaceLocal>/.claude-plugin/marketplace.json; lanza Error en español si no sirve
function leerMarketplaceLocal(raiz, marketplaceLocal) {
  const ruta = join(raiz, marketplaceLocal, '.claude-plugin', 'marketplace.json');
  let obj;
  try {
    obj = leerJson(ruta);
  } catch (error) {
    throw new Error(`No se pudo leer el marketplace local ${ruta}: ${error.message}`);
  }
  if (obj === null || typeof obj !== 'object' || !argumentoSeguro(obj.name) || !Array.isArray(obj.plugins)) {
    throw new Error(`El marketplace local ${ruta} debe tener "name" válido y la lista "plugins"`);
  }
  return obj;
}

// Plugins del marketplace local declarado en flujo.json (campo opcional marketplaceLocal)
function procesarLocales({ raiz, flujo, perfiles, dryRun, ejecutar, preguntar }) {
  const marketplaceLocal = flujo?.marketplaceLocal;
  if (marketplaceLocal === undefined) return;
  if (!argumentoSeguro(marketplaceLocal)) {
    console.log(`Aviso: marketplaceLocal tiene un valor no permitido: "${marketplaceLocal}"; se omiten los plugins locales.`);
    return;
  }
  // Con "./" delante para que claude lo trate como ruta y no como un repositorio "propietario/nombre"
  const origen = marketplaceLocal.startsWith('./') ? marketplaceLocal : `./${marketplaceLocal}`;

  let faltantes;
  try {
    const marketplace = leerMarketplaceLocal(raiz, marketplaceLocal);
    const instalados = listarInstalados(ejecutar).map((p) => p.id);
    ({ faltantes } = planificarLocales({ marketplace, perfiles, instalados }));
  } catch (error) {
    console.log(`Aviso: ${error.message}; se omiten los plugins locales.`);
    return;
  }
  const inseguro = faltantes.find((id) => !argumentoSeguro(id));
  if (inseguro !== undefined) {
    console.log(`Aviso: el plugin local "${inseguro}" tiene un nombre no permitido; se omiten los plugins locales.`);
    return;
  }
  if (faltantes.length === 0) {
    console.log('Todos los plugins locales aplicables están instalados.');
    return;
  }
  if (dryRun) {
    console.log(`Plugins locales que faltan (simulación, no se instala nada; marketplace ${origen}):`);
    faltantes.forEach((id) => console.log(`- ${id} [local]`));
    return;
  }

  let anadido = false;
  for (const id of faltantes) {
    console.log(`\nInstalar ${id} [local]`);
    if (!anadido) console.log(`  Comando: claude plugin marketplace add ${origen}`);
    console.log(`  Comando: claude plugin install ${id}`);
    if (!preguntar(`¿Instalar ${id}?`)) {
      console.log('  Omitido por el usuario.');
      continue;
    }
    try {
      if (!anadido) {
        ejecutar('claude', ['plugin', 'marketplace', 'add', origen], { cwd: raiz });
        anadido = true;
      }
      ejecutar('claude', ['plugin', 'install', id], { cwd: raiz });
    } catch (error) {
      console.error(`  Falló la instalación de ${id}: ${error.message}`);
    }
  }
  if (!anadido) return;

  let despues;
  try {
    despues = listarInstalados(ejecutar).map((p) => p.id);
  } catch (error) {
    console.error(`No se pudo verificar la instalación de los plugins locales: ${error.message}`);
    return;
  }
  faltantes.forEach((id) => console.log(`${despues.includes(id) ? 'Instalado' : 'Sin instalar'}: ${id}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main({ argv: process.argv.slice(2) }));
}
