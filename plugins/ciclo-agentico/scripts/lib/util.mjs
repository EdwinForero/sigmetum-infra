import { readFileSync } from 'node:fs';

// Utilidades comunes de los scripts del plugin (sin dependencias).

// Quita un BOM UTF-8 inicial (lo añaden algunos editores de Windows) para que JSON.parse no falle
const BOM = String.fromCharCode(0xfeff);
export const quitarBom = (texto) => (texto.startsWith(BOM) ? texto.slice(1) : texto);

// CRLF (Windows) → LF
export const normalizarFinesDeLinea = (texto) => String(texto).replace(/\r\n/g, '\n');

// Barras invertidas (Windows) → "/"
export const normalizarRuta = (ruta) => ruta.replace(/\\/g, '/');

// Escapa los caracteres especiales de una expresión regular para buscar el texto literal
export const escaparRegExp = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lee un archivo JSON tolerando BOM inicial y CRLF. Lanza el error de lectura o de JSON.parse: lo gestiona el llamador.
export function leerJson(ruta) {
  return JSON.parse(normalizarFinesDeLinea(quitarBom(readFileSync(ruta, 'utf8'))));
}
