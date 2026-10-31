import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pruebas del marketplace local "locales-infra" y de las skills de todos sus plugins.
// Viven fuera de plugins/ciclo-agentico para no romper la portabilidad del núcleo.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOM = String.fromCharCode(0xfeff);
const leerJson = (ruta) => {
  const texto = readFileSync(ruta, 'utf8');
  return JSON.parse(texto.startsWith(BOM) ? texto.slice(1) : texto);
};
const mercado = leerJson(join(raiz, '.claude-plugin', 'marketplace.json'));
const rutaPlugin = (entrada) => join(raiz, entrada.source);

// Devuelve { name, description } del frontmatter YAML simple de un SKILL.md, o null si no lo tiene
function frontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (!m) return null;
  const campos = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const par = /^([A-Za-z-]+):\s*(.*)$/.exec(linea);
    if (par) campos[par[1]] = par[2].trim();
  }
  return campos;
}

// Lista [plugin, carpeta de skill, ruta del SKILL.md] de todos los plugins del marketplace
function skills() {
  return mercado.plugins.flatMap((entrada) => {
    const dir = join(rutaPlugin(entrada), 'skills');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => [entrada.name, e.name, join(dir, e.name, 'SKILL.md')]);
  });
}

const sigmetum = /(?<![A-Za-z0-9])sigmetum(?![A-Za-z0-9])/i;

test('el marketplace tiene nombre, propietario y descripción', () => {
  assert.equal(mercado.name, 'locales-infra');
  assert.equal(typeof mercado.owner?.name, 'string');
  assert.ok(mercado.owner.name.length > 0);
  assert.equal(typeof mercado.description, 'string');
  assert.ok(mercado.description.length > 0);
  assert.ok(Array.isArray(mercado.plugins) && mercado.plugins.length > 0);
});

test('cada plugin existe en su source, su plugin.json tiene el mismo nombre y lleva un tag perfil:<x>', () => {
  for (const entrada of mercado.plugins) {
    assert.ok(entrada.source.startsWith('./'), `${entrada.name}: source debe ser relativo`);
    const manifiesto = join(rutaPlugin(entrada), '.claude-plugin', 'plugin.json');
    assert.ok(existsSync(manifiesto), `${entrada.name}: no existe ${manifiesto}`);
    assert.equal(leerJson(manifiesto).name, entrada.name);
    assert.ok(
      Array.isArray(entrada.tags) && entrada.tags.some((t) => /^perfil:[a-z0-9-]+$/.test(t)),
      `${entrada.name}: falta un tag perfil:<x>`,
    );
  }
});

test('ningún plugin conserva un marketplace propio', () => {
  for (const entrada of mercado.plugins) {
    assert.ok(
      !existsSync(join(rutaPlugin(entrada), '.claude-plugin', 'marketplace.json')),
      `${entrada.name}: el marketplace debe ser solo plugins/.claude-plugin/marketplace.json`,
    );
  }
});

test('cada skill tiene SKILL.md con name igual a su carpeta y description', () => {
  const lista = skills();
  assert.ok(lista.length > 0);
  for (const [plugin, carpeta, ruta] of lista) {
    assert.ok(existsSync(ruta), `${plugin}/${carpeta}: falta SKILL.md`);
    const campos = frontmatter(readFileSync(ruta, 'utf8'));
    assert.ok(campos, `${plugin}/${carpeta}: SKILL.md sin frontmatter`);
    assert.equal(campos.name, carpeta, `${plugin}/${carpeta}: name distinto de la carpeta`);
    assert.ok(campos.description, `${plugin}/${carpeta}: falta description`);
  }
});

test('ninguna skill nombra el proyecto', () => {
  const hallazgos = skills()
    .filter(([, , ruta]) => sigmetum.test(readFileSync(ruta, 'utf8')))
    .map(([plugin, carpeta]) => `${plugin}/${carpeta}`);
  assert.deepEqual(hallazgos, []);
});
