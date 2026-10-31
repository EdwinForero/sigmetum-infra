import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarFlujo } from './lib/flujo.mjs';
import { escaparRegExp, normalizarFinesDeLinea, normalizarRuta } from './lib/util.mjs';

// "*" = cualquier cosa dentro de un segmento; "**" = cualquier cosa, incluidas las barras
export function coincide(ruta, patron) {
  const p = normalizarRuta(patron);
  let fuente = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      if (p[i + 1] === '*') {
        fuente += '.*';
        i++;
      } else {
        fuente += '[^/]*';
      }
    } else {
      fuente += escaparRegExp(p[i]);
    }
  }
  return new RegExp(`^${fuente}$`).test(normalizarRuta(ruta));
}

const literales = (patron) => [...patron].filter((c) => c !== '*').length;

export function docsDeArea(ruta, docsPorArea) {
  const candidatos = Object.entries(docsPorArea).filter(([patron]) => coincide(ruta, patron));
  if (candidatos.length === 0) return null;
  const mejor = Math.max(...candidatos.map(([patron]) => literales(patron)));
  const ganadores = candidatos.filter(([patron]) => literales(patron) === mejor);
  return [...new Set(ganadores.flatMap(([, docs]) => docs))];
}

export function fechaHoy(fecha = new Date()) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()}`;
}

export function cambiosGit(raiz) {
  const salida = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  const registros = salida.split('\0').filter((r) => r !== '');
  const rutas = new Set();
  for (let i = 0; i < registros.length; i++) {
    const registro = registros[i];
    const estado = registro.slice(0, 2);
    rutas.add(normalizarRuta(registro.slice(3)));
    if (/[RC]/.test(estado) && i + 1 < registros.length) {
      i++;
      rutas.add(normalizarRuta(registros[i]));
    }
  }
  return [...rutas];
}

const PREFIJO_SIN_IMPACTO = 'Integración: sin impacto — ';
// Línea que empieza literalmente por el prefijo y sigue con un motivo no vacío
const LINEA_SIN_IMPACTO = /^Integración: sin impacto — [^\n]*\S/m;

// textosAviso (opcional): { ruta: texto } de los avisos para PR; sin él, solo vale que cambie integracion
export function evaluarGate({ cambios, flujo, hoy, textoEstado, textosAviso = {} }) {
  const problemas = [];
  const lista = cambios.map(normalizarRuta);

  const obligatorios = new Set([flujo.estado, ...flujo.docsObligatorios].map(normalizarRuta));
  for (const doc of obligatorios) {
    if (!lista.includes(normalizarRuta(doc))) {
      problemas.push(`El documento obligatorio ${doc} no aparece modificado`);
    }
  }

  const texto = normalizarFinesDeLinea(textoEstado);
  let coincidencia = null;
  try {
    coincidencia = new RegExp(flujo.estadoFecha).exec(texto);
  } catch {
    coincidencia = null;
  }
  if (!coincidencia || coincidencia[1] === undefined) {
    problemas.push(`En ${flujo.estado} no se encontró la fecha de actualización (patrón: ${flujo.estadoFecha})`);
  } else if (coincidencia[1] !== hoy) {
    problemas.push(`La fecha de ${flujo.estado} es ${coincidencia[1]} y debería ser ${hoy}`);
  }

  for (const archivo of lista) {
    const docs = docsDeArea(archivo, flujo.docsPorArea);
    if (docs !== null && !docs.some((d) => lista.includes(normalizarRuta(d)))) {
      problemas.push(`${archivo} cambió pero no se modificó ninguno de sus documentos: ${docs.join(', ')}`);
    }
  }

  const contrato = lista.find((c) => flujo.areasContrato.some((p) => coincide(c, p)));
  if (contrato !== undefined) {
    const avisos = lista.filter((c) => coincide(c, flujo.avisoPR));
    if (avisos.length === 0) {
      problemas.push(`${contrato} toca un área de contrato y falta el aviso para PR (${flujo.avisoPR})`);
    }
    const integracion = Array.isArray(flujo.integracion) ? flujo.integracion : null;
    const integracionCambiada = integracion !== null && lista.some((c) => integracion.some((p) => coincide(c, p)));
    const textos = Object.fromEntries(Object.entries(textosAviso).map(([ruta, t]) => [normalizarRuta(ruta), t]));
    const sinImpacto = avisos.some((a) => LINEA_SIN_IMPACTO.test(normalizarFinesDeLinea(textos[a] ?? '')));
    if (!integracionCambiada && !sinImpacto) {
      const opcionA = integracion === null
        ? 'flujo.json no define integracion, así que solo vale que'
        : `debe cambiar algún documento de integracion (${integracion.join(', ')}) o`;
      problemas.push(
        `${contrato} toca un área de contrato: ${opcionA} el aviso para PR (${flujo.avisoPR}) incluya una línea que empiece por "${PREFIJO_SIN_IMPACTO}" seguida del motivo`,
      );
    }
  }

  return { ok: problemas.length === 0, problemas };
}

function leerArgumentos(argv) {
  const opciones = { raiz: process.cwd(), soloValidar: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--raiz' && i + 1 < argv.length) {
      opciones.raiz = argv[++i];
    } else if (argv[i] === '--solo-validar') {
      opciones.soloValidar = true;
    }
  }
  return opciones;
}

export function ejecutar(argv) {
  const { raiz, soloValidar } = leerArgumentos(argv);
  const { flujo, problemas } = cargarFlujo(raiz);
  if (flujo === null) {
    problemas.forEach((p) => console.error(p));
    return 1;
  }
  if (soloValidar) {
    console.log('flujo.json es válido');
    return 0;
  }

  let textoEstado = '';
  try {
    textoEstado = readFileSync(join(raiz, flujo.estado), 'utf8');
  } catch (error) {
    console.error(`No se pudo leer ${flujo.estado}: ${error.message}`);
    return 1;
  }

  let cambios;
  try {
    cambios = cambiosGit(raiz);
  } catch (error) {
    console.error(`No se pudo consultar el estado de git: ${error.message}`);
    return 1;
  }

  // Avisos para PR que están en cambios (un aviso borrado no se puede leer: no aporta texto)
  const textosAviso = {};
  for (const ruta of cambios.filter((c) => coincide(c, flujo.avisoPR))) {
    try {
      textosAviso[ruta] = readFileSync(join(raiz, ruta), 'utf8');
    } catch {
      // borrado o ilegible
    }
  }

  const resultado = evaluarGate({ cambios, flujo, hoy: fechaHoy(), textoEstado, textosAviso });
  if (resultado.ok) {
    console.log('Cierre documental correcto');
    return 0;
  }
  console.error('Cierre documental incompleto:');
  resultado.problemas.forEach((p) => console.error(`- ${p}`));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(ejecutar(process.argv.slice(2)));
}
