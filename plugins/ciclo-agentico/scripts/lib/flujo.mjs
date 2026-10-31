import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { leerJson } from './util.mjs';

const esTexto = (v) => typeof v === 'string';
const esListaTexto = (v) => Array.isArray(v) && v.every(esTexto);
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Cuenta los grupos de captura de una expresión regular ya compilada
const gruposCaptura = (patron) => new RegExp(`${patron}|`).exec('').length - 1;

// Solo caracteres que ningún shell interpreta; no puede empezar por "-" (evita que parezca una opción).
// Es una validación de forma: la usan el bootstrap (argumentos de claude) y validarFlujo (marketplaceLocal).
export function argumentoSeguro(valor) {
  return typeof valor === 'string' && /^[A-Za-z0-9@._:/+-]+$/.test(valor) && !valor.startsWith('-');
}

// Ruta (ya segura de forma) que no sale del proyecto: sin "/" inicial, sin letra de unidad y sin segmentos ".."
const dentroDelProyecto = (v) => !v.startsWith('/') && !/^[A-Za-z]:/.test(v) && !v.split('/').includes('..');

// Campos opcionales de flujo.json: si faltan, los roles siguen sin ellos. Solo los que figuran en
// FORMA_OPCIONAL tienen una forma exigida (reglas en orden; se informa la primera que falla); el resto
// admite cualquier valor.
export const OPCIONALES = ['integracion', 'skillsProyecto', 'docsRegla', 'criticidad', 'marketplaceLocal'];
const FORMA_OPCIONAL = {
  marketplaceLocal: [
    {
      valido: argumentoSeguro,
      descripcion: 'una ruta relativa con barras "/" (letras, números y @._:/+-, sin "-" inicial)',
    },
    {
      valido: dentroDelProyecto,
      descripcion: 'una ruta relativa dentro del proyecto (sin segmentos "..", sin "/" inicial y sin letra de unidad como "C:")',
    },
  ],
};

export function validarFlujo(obj) {
  if (!esObjeto(obj)) {
    return { ok: false, problemas: ['flujo.json debe ser un objeto JSON'] };
  }
  const problemas = [];

  const exigir = (campo, valido, descripcion) => {
    if (obj[campo] === undefined) {
      problemas.push(`Falta el campo obligatorio "${campo}" (${descripcion})`);
    } else if (!valido(obj[campo])) {
      problemas.push(`El campo "${campo}" no es válido: debe ser ${descripcion}`);
    }
  };

  exigir('guias', esListaTexto, 'una lista de textos');
  exigir('estado', esTexto, 'un texto');
  exigir('estadoFecha', esTexto, 'un texto');
  if (esTexto(obj.estadoFecha)) {
    try {
      if (gruposCaptura(obj.estadoFecha) !== 1) {
        problemas.push('El campo "estadoFecha" no es válido: la expresión regular debe tener exactamente un grupo de captura');
      }
    } catch {
      problemas.push('El campo "estadoFecha" no es válido: no es una expresión regular');
    }
  }
  exigir('verificacion', esObjeto, 'un objeto');
  exigir('specsDir', esTexto, 'un texto');
  exigir('maxVueltas', (v) => Number.isInteger(v) && v >= 1, 'un entero mayor o igual que 1');
  exigir('consultor', (v) => v === 'octopus' || v === 'ninguno', '"octopus" o "ninguno"');
  exigir('estilo', (v) => v === 'i-have-adhd' || v === 'ninguno', '"i-have-adhd" o "ninguno"');
  exigir('perfiles', esListaTexto, 'una lista de textos');
  exigir('docsObligatorios', esListaTexto, 'una lista de textos');
  exigir(
    'docsPorArea',
    (v) => esObjeto(v) && Object.values(v).every(esListaTexto),
    'un objeto cuyos valores son listas de textos',
  );
  exigir('areasContrato', esListaTexto, 'una lista de textos');
  exigir('avisoPR', esTexto, 'un texto');
  for (const campo of OPCIONALES) {
    if (obj[campo] === undefined) continue;
    const fallida = (FORMA_OPCIONAL[campo] ?? []).find((regla) => !regla.valido(obj[campo]));
    if (fallida) {
      problemas.push(`El campo "${campo}" no es válido: debe ser ${fallida.descripcion}`);
    }
  }

  return { ok: problemas.length === 0, problemas };
}

export function cargarFlujo(raiz) {
  const ruta = join(raiz, '.claude', 'flujo.json');
  if (!existsSync(ruta)) {
    return {
      flujo: null,
      problemas: [`No existe ${ruta}. Ejecuta /ciclo-init para crearlo.`],
    };
  }
  let flujo;
  try {
    flujo = leerJson(ruta);
  } catch (error) {
    return {
      flujo: null,
      problemas: [`No se pudo leer ${ruta} como JSON: ${error.message}`],
    };
  }
  const { ok, problemas } = validarFlujo(flujo);
  return ok ? { flujo, problemas: [] } : { flujo: null, problemas };
}
