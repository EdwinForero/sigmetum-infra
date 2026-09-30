// Comprueba que la documentación sigue el ritmo del código de Terraform.
// Uso: node scripts/docs-check.mjs              (sale con código 1 si algo está desactualizado)
//      node scripts/docs-check.mjs --strict     (los avisos entre repositorios también hacen fallar)
//      node scripts/docs-check.mjs --metrics    (imprime las métricas reales para docs/estado-y-deuda-tecnica.md)
// No necesita dependencias ni `terraform init`. Solo lee nombres: nunca imprime valores de terraform.tfvars.
// Las reglas y lo que NO se comprueba automáticamente están en docs/guias/mantenimiento.md.
// El código y la seguridad los vigila scripts/quality-check.mjs.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = resolve(ROOT, '..', 'sigmetum-backend');
const FRONTEND = resolve(ROOT, '..', 'sigmetum-frontend');

const read = (file, base = ROOT) => readFileSync(join(base, file), 'utf8').replace(/\r\n/g, '\n');
const posix = (file) => file.split(sep).join('/');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SKIP_DIRS = new Set(['.git', '.terraform', 'node_modules']);

const walk = (dir) =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = posix(join(dir, name));
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });

const subdirs = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((name) => statSync(join(ROOT, dir, name)).isDirectory() && !SKIP_DIRS.has(name))
    .sort();

// ── Lectura de HCL (solo lo que hace falta; sin intérprete) ────────────────────────────────────
const stripComments = (text) => text.replace(/^\s*#.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');

const blocks = (text, keyword) => {
  const out = [];
  const re = new RegExp(`^${keyword}\\s+"([^"]+)"(?:\\s+"([^"]+)")?\\s*\\{`, 'gm');
  let match;
  while ((match = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out.push({ name: match[1], label: match[2], body: text.slice(re.lastIndex, i - 1) });
  }
  return out;
};

const topLevel = (body) => {
  let depth = 0;
  let out = '';
  for (const char of body) {
    if (char === '{') depth++;
    if (depth === 0) out += char;
    if (char === '}') depth--;
  }
  return out;
};

const hcl = (file) => (existsSync(join(ROOT, file)) ? stripComments(read(file)) : '');
const variablesOf = (dir) =>
  blocks(hcl(`${dir}/variables.tf`), 'variable').map(({ name, body }) => ({
    name,
    hasDefault: /^\s*default\s*=/m.test(topLevel(body)),
    sensitive: /^\s*sensitive\s*=\s*true/m.test(topLevel(body)),
  }));
const outputsOf = (dir) => blocks(hcl(`${dir}/outputs.tf`), 'output').map(({ name }) => name);

const modules = subdirs('modules');
const environments = subdirs('environments');
const tfFiles = walk('.').filter((file) => file.endsWith('.tf'));

// ── Documentos ─────────────────────────────────────────────────────────────────────────────────
const docFiles = ['README.md', 'CLAUDE.md', ...walk('docs').filter((file) => file.endsWith('.md'))].filter(
  (file) => existsSync(join(ROOT, file))
);
const docs = Object.fromEntries(docFiles.map((file) => [file, read(file)]));
const REFERENCE = 'docs/referencia-modulos.md';
const STATE = 'docs/estado-y-deuda-tecnica.md';
const BILLING = 'docs/billing-tags.md';
const MAINTENANCE = 'docs/guias/mantenimiento.md';

const section = (doc, heading, level = 2) => {
  const start = new RegExp(`^${'#'.repeat(level)} ${escapeRegExp(heading)}\\s*$`, 'm').exec(doc ?? '');
  if (!start) return null;
  const rest = doc.slice(start.index + start[0].length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
};

const tableRows = (text) =>
  (text ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));

const namedRows = (text) => tableRows(text).filter((cells) => /^`[^`]+`$/.test(cells[0])).map((cells) => [cells[0].slice(1, -1), ...cells.slice(1)]);

const parseExample = (env) => {
  const file = `environments/${env}/terraform.tfvars.example`;
  if (!existsSync(join(ROOT, file))) return null;
  const text = stripComments(read(file));
  const topKeys = [...text.matchAll(/^([a-z_][a-z0-9_]*)\s*=/gm)].map((m) => m[1]);
  const envBlock = /^app_env_vars\s*=\s*\{([\s\S]*?)^\}/m.exec(text);
  const appKeys = envBlock ? [...envBlock[1].matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]) : [];
  const value = (key, scope = text) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(scope)?.[1];
  return { file, text, topKeys, appKeys, value, envText: envBlock?.[1] ?? '' };
};
const examples = Object.fromEntries(environments.map((env) => [env, parseExample(env)]));

const providerRegion = (env) => /region\s*=\s*"([^"]+)"/.exec(hcl(`environments/${env}/providers.tf`))?.[1];
const envModules = (env) => blocks(hcl(`environments/${env}/main.tf`), 'module');
const moduleBody = (env, name) => envModules(env).find((m) => m.name === name)?.body;
const strArg = (body, key) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(body ?? '')?.[1];

const setDiff = (a, b) => [...a].filter((item) => !b.has(item));

// ── Métricas ───────────────────────────────────────────────────────────────────────────────────
const metrics = () => ({
  'Módulos': modules.length,
  'Entornos': environments.length,
  'Archivos .tf': tfFiles.length,
  'Variables de módulos': modules.reduce((sum, m) => sum + variablesOf(`modules/${m}`).length, 0),
  'Outputs de módulos': modules.reduce((sum, m) => sum + outputsOf(`modules/${m}`).length, 0),
  'Recursos declarados': tfFiles.reduce((sum, file) => sum + blocks(hcl(file), 'resource').length, 0),
  'Claves de app_env_vars': examples.dev?.appKeys.length ?? 0,
});

if (process.argv.includes('--metrics')) {
  console.log(metrics());
  process.exit(0);
}

const strict = process.argv.includes('--strict');
const results = [];
const warnings = [];
const check = (name, problems) => results.push({ name, problems });
const warn = (name, items) => warnings.push({ name, items });

// 1. Enlaces internos y anclas ───────────────────────────────────────────────────────────────────
const slug = (heading) =>
  heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const anchorsOf = (text) => {
  let inFence = false;
  const anchors = new Set();
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    const match = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (match) anchors.add(slug(match[1]));
  }
  return anchors;
};

{
  const problems = [];
  const missingSiblings = new Set();
  const where0 = (file, index) => `${file}:${index + 1}`;
  for (const [file, text] of Object.entries(docs)) {
    let inFence = false;
    text.split('\n').forEach((line, index) => {
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      if (inFence) return;
      for (const [, target] of line.replace(/`[^`]*`/g, '').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [pathPart, anchor] = target.split('#');
        const absolute = pathPart ? resolve(ROOT, dirname(file), pathPart) : join(ROOT, file);
        if (relative(ROOT, absolute).startsWith('..')) {
          // Enlace a un repositorio hermano: se comprueba si está presente; si no, solo se avisa.
          const sibling = /(?:^|[\\/])(sigmetum-[\w-]+)[\\/]/.exec(relative(ROOT, absolute))?.[1];
          if (!sibling) continue;
          if (!existsSync(resolve(ROOT, '..', sibling))) missingSiblings.add(sibling);
          else if (!existsSync(absolute)) problems.push(`${where0(file, index)} enlaza a ${target}, que no existe en ${sibling}`);
          continue;
        }
        const targetFile = posix(relative(ROOT, absolute));
        const where = `${file}:${index + 1}`;
        if (!existsSync(absolute)) problems.push(`${where} enlaza a ${target}, que no existe`);
        else if (anchor && targetFile.endsWith('.md') && !anchorsOf(docs[targetFile] ?? read(targetFile)).has(anchor)) {
          problems.push(`${where} enlaza a ${target}, pero el apartado no existe`);
        }
      }
    });
  }
  check('Enlaces internos y anclas', problems);
  warn('Enlaces a repositorios hermanos', [...missingSiblings].map((name) => `No existe ../${name}: sus enlaces no se han podido comprobar`));
}

// 2. Documentos nuevos enlazados desde el README ────────────────────────────────────────────────
check(
  'Índice de documentos (docs/ → README.md)',
  docFiles.filter((file) => file.startsWith('docs/') && !docs['README.md'].includes(`(${file}`)).map((file) => `${file} no está enlazado desde el README`)
);

// 2b. Cada guía normativa figura en el índice del README y en CLAUDE.md
check(
  'Guías (docs/guias → README.md y CLAUDE.md)',
  docFiles
    .filter((file) => file.startsWith('docs/guias/'))
    .flatMap((file) => [
      !docs['README.md'].includes(`(${file}`) && `${file} no figura en el índice del README`,
      !(docs['CLAUDE.md'] ?? '').includes(file) && `${file} no figura en CLAUDE.md`,
    ])
    .filter(Boolean)
);

// 2c. Cada documento de integración figura en el índice del README y en CLAUDE.md
check(
  'Documentos de integración (docs/integracion → README.md y CLAUDE.md)',
  docFiles
    .filter((file) => file.startsWith('docs/integracion/'))
    .flatMap((file) => [
      !docs['README.md'].includes(`(${file}`) && `${file} no figura en el índice del README`,
      !(docs['CLAUDE.md'] ?? '').includes(file) && `${file} no figura en CLAUDE.md`,
    ])
    .filter(Boolean)
);

// 2d. Los comandos de la definición de terminado son los mismos en CLAUDE.md, las guías, la plantilla de PR y la CI
{
  const commands = ['terraform fmt -check -recursive', 'terraform validate', 'node scripts/quality-check.mjs', 'node scripts/docs-check.mjs'];
  const sources = ['CLAUDE.md', 'docs/guias/mantenimiento.md', 'docs/guias/buenas-practicas-terraform.md', '.github/pull_request_template.md', '.github/workflows/ci.yml'];
  const problems = [];
  for (const file of sources) {
    if (!existsSync(join(ROOT, file))) {
      problems.push(`Falta ${file}`);
      continue;
    }
    const text = docs[file] ?? read(file);
    for (const command of commands) if (!text.includes(command)) problems.push(`${file} no contiene el comando "${command}"`);
  }
  check('Comandos de la definición de terminado (CLAUDE.md, guías, plantilla de PR y CI)', problems);
}

// 3. Módulos y entornos frente a la arquitectura del README ───────────────────────────────────────
{
  const problems = [];
  const lines = (/^## Architecture\s*\n+```[^\n]*\n([\s\S]*?)```/m.exec(docs['README.md'])?.[1] ?? '').split('\n');
  const listed = { environments: new Set(), modules: new Set() };
  let parent;
  for (const line of lines) {
    const top = /^(environments|modules)\/\s*$/.exec(line);
    if (top) parent = top[1];
    const item = parent && /^\s+([\w-]+)\/\s+—/.exec(line);
    if (item) listed[parent].add(item[1]);
  }
  for (const [kind, actual] of [['modules', modules], ['environments', environments]]) {
    setDiff(new Set(actual), listed[kind]).forEach((name) => problems.push(`${kind}/${name} no aparece en el bloque "Architecture" del README`));
    setDiff(listed[kind], new Set(actual)).forEach((name) => problems.push(`El README menciona ${kind}/${name}, que no existe`));
  }
  const used = new Set();
  for (const env of environments) {
    for (const [, source] of hcl(`environments/${env}/main.tf`).matchAll(/source\s*=\s*"\.\.\/\.\.\/modules\/([\w-]+)"/g)) {
      used.add(source);
      if (!modules.includes(source)) problems.push(`environments/${env}/main.tf usa el módulo ${source}, que no existe`);
    }
  }
  setDiff(new Set(modules), used).forEach((name) => problems.push(`El módulo ${name} no lo usa ningún entorno`));
  for (const name of modules) if (!section(docs[REFERENCE], `Módulo ${name}`)) problems.push(`${REFERENCE} no tiene la sección "Módulo ${name}"`);
  for (const name of environments) if (!section(docs[REFERENCE], `Entorno ${name}`)) problems.push(`${REFERENCE} no tiene la sección "Entorno ${name}"`);
  check('Módulos y entornos (código → README y referencia)', problems);
}

// 4. Tabla de recursos del README frente al código ───────────────────────────────────────────────
{
  const problems = [];
  const rows = tableRows(/^\| Resource \|[\s\S]*?(?=\n\n)/m.exec(docs['README.md'])?.[0]);
  const header = (rows[0] ?? []).map((cell) => cell.toLowerCase());
  const plain = (cell) => (cell ?? '').replace(/`/g, '');
  const cellFor = (label, env) => plain(rows.find((row) => row[0] === label)?.[header.indexOf(env)]);
  const beanstalk = hcl('modules/beanstalk/main.tf');
  const amplify = hcl('modules/amplify/main.tf');
  const nameOf = (text, type) => new RegExp(`resource "${type}" "this" \\{\\s*name\\s*=\\s*"([^"]+)"`).exec(text)?.[1];
  const appDefault = /variable "app_name"[\s\S]*?default\s*=\s*"([^"]+)"/.exec(read('modules/amplify/variables.tf'))?.[1];

  for (const env of environments) {
    if (!header.includes(env)) {
      problems.push(`La tabla de recursos del README no tiene columna para ${env}`);
      continue;
    }
    const expect = (label, expected, ok = (cell) => cell === expected) => {
      const cell = cellFor(label, env);
      if (!ok(cell)) problems.push(`README, fila "${label}" (${env}): dice "${cell}" y el código da "${expected}"`);
    };
    const sub = (template) => template?.replace('${var.environment}', env).replace('${var.app_name}', appDefault);
    const beanstalkBody = moduleBody(env, 'beanstalk');
    const amplifyBody = moduleBody(env, 'amplify');
    expect('Beanstalk app', sub(nameOf(beanstalk, 'aws_elastic_beanstalk_application')));
    expect('Beanstalk env', sub(nameOf(beanstalk, 'aws_elastic_beanstalk_environment')));
    expect('S3 bucket', examples[env]?.value('bucket_name') ?? '(sin ejemplo)');
    expect('Amplify app', sub(nameOf(amplify, 'aws_amplify_app')));
    expect('Amplify branch', strArg(amplifyBody, 'branch'));
    const type = strArg(beanstalkBody, 'instance_type');
    const max = Number(/max_instances\s*=\s*(\d+)/.exec(beanstalkBody)?.[1] ?? 1);
    const min = Number(/min_instances\s*=\s*(\d+)/.exec(beanstalkBody)?.[1] ?? 1);
    expect('Instance type', type, (cell) => cell.startsWith(type) && (max === 1 || cell.includes(`${min}–${max}`)));
    const lb = strArg(beanstalkBody, 'load_balancer_type');
    expect('Load balancer', lb, (cell) => (lb === 'single' ? /none/i.test(cell) : /ALB/.test(cell)));
    const https = /ssl_certificate_arn\s*=/.test(beanstalkBody ?? '');
    expect('HTTPS', https ? 'Yes' : 'No', (cell) => (https ? /yes/i.test(cell) : /^no/i.test(cell)));
    const dnsBody = moduleBody(env, 'dns');
    const fqdn = dnsBody ? `backend.${strArg(dnsBody, 'zone_name')}` : '—';
    expect('DNS', fqdn);
    expect('Region', providerRegion(env));
  }
  check('Tabla de recursos (README → código)', problems);
}

// 5. Variables y outputs de módulos y entornos frente a la referencia ─────────────────────────────
{
  const problems = [];
  const compare = (dir, heading) => {
    const doc = section(docs[REFERENCE], heading);
    if (doc === null) return;
    const vars = variablesOf(dir);
    const docVars = namedRows(section(doc, 'Variables', 3));
    const docOuts = new Set(namedRows(section(doc, 'Outputs', 3)).map((row) => row[0]));
    const docVarNames = new Set(docVars.map((row) => row[0]));
    vars.filter((v) => !docVarNames.has(v.name)).forEach((v) => problems.push(`${heading}: la variable ${v.name} no está documentada`));
    setDiff(docVarNames, new Set(vars.map((v) => v.name))).forEach((name) => problems.push(`${heading}: se documenta la variable ${name}, que no existe`));
    for (const row of docVars) {
      const variable = vars.find((v) => v.name === row[0]);
      if (variable && variable.hasDefault !== (row[2] !== '—')) {
        problems.push(`${heading}: "Por defecto" de ${row[0]} no coincide (${variable.hasDefault ? 'tiene default' : 'es obligatoria y debe llevar —'})`);
      }
    }
    const outs = new Set(outputsOf(dir));
    setDiff(outs, docOuts).forEach((name) => problems.push(`${heading}: el output ${name} no está documentado`));
    setDiff(docOuts, outs).forEach((name) => problems.push(`${heading}: se documenta el output ${name}, que no existe`));
  };
  modules.forEach((name) => compare(`modules/${name}`, `Módulo ${name}`));
  environments.forEach((name) => compare(`environments/${name}`, `Entorno ${name}`));
  check('Variables y outputs (código → docs/referencia-modulos.md)', problems);
}

// 6. Plantillas tfvars.example: claves, región y coherencia con la documentación ──────────────────
{
  const problems = [];
  const docKeys = new Set(namedRows(section(docs[REFERENCE], 'app_env_vars')).map((row) => row[0]));
  for (const env of environments) {
    const example = examples[env];
    if (!example) {
      problems.push(`environments/${env} no tiene terraform.tfvars.example`);
      continue;
    }
    const declared = variablesOf(`environments/${env}`);
    declared.filter((v) => !v.hasDefault && !example.topKeys.includes(v.name)).forEach((v) => problems.push(`${example.file} no define la variable obligatoria ${v.name}`));
    example.topKeys.filter((key) => !declared.some((v) => v.name === key)).forEach((key) => problems.push(`${example.file} define ${key}, que no es una variable del entorno`));
    const own = new Set(example.appKeys);
    setDiff(docKeys, own).forEach((key) => problems.push(`${example.file}: falta la clave ${key} de app_env_vars documentada en la referencia`));
    setDiff(own, docKeys).forEach((key) => problems.push(`${example.file}: la clave ${key} de app_env_vars no está documentada en la referencia`));
    const region = providerRegion(env);
    const awsRegion = example.value('AWS_REGION', example.envText);
    if (awsRegion !== region) problems.push(`${example.file}: AWS_REGION (${awsRegion}) no coincide con la región del proveedor (${region})`);
    const arnRegion = /arn:aws:acm:([a-z0-9-]+):/.exec(example.text)?.[1];
    if (arnRegion && arnRegion !== region) problems.push(`${example.file}: el ARN de ACM es de ${arnRegion} y el proveedor usa ${region}`);
    if (example.value('AWS_BUCKET_NAME', example.envText) !== example.value('bucket_name')) problems.push(`${example.file}: AWS_BUCKET_NAME y bucket_name deberían coincidir`);
    const stateRegion = /region\s*=\s*"([^"]+)"/.exec(hcl(`environments/${env}/backend.tf`))?.[1];
    if (stateRegion !== region) problems.push(`environments/${env}/backend.tf usa la región ${stateRegion} y el proveedor ${region}`);
  }
  check('Plantillas terraform.tfvars.example y regiones', problems);
}

// 7. Variables de Amplify (código → referencia) ──────────────────────────────────────────────────
const amplifyKeys = (() => {
  const text = hcl('modules/amplify/main.tf');
  const keys = new Set();
  for (const [, body] of text.matchAll(/environment_variables\s*=\s*\{([\s\S]*?)\n\s*\}/g)) {
    for (const [, key] of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) keys.add(key);
  }
  return keys;
})();
{
  const documented = new Set(namedRows(section(section(docs[REFERENCE], 'Módulo amplify'), 'Variables de Amplify', 3)).map((row) => row[0]));
  check('Variables de Amplify (modules/amplify → referencia)', [
    ...setDiff(amplifyKeys, documented).map((key) => `${key} no aparece en "Variables de Amplify"`),
    ...setDiff(documented, amplifyKeys).map((key) => `Se documenta ${key}, que el módulo ya no define`),
  ]);
}

// 8. Etiquetas de costes y secretos ──────────────────────────────────────────────────────────────
{
  const problems = [];
  const billing = docs[BILLING] ?? '';
  const components = new Set(tfFiles.filter((f) => f.startsWith('modules/')).flatMap((f) => [...hcl(f).matchAll(/Component\s*=\s*"([^"]+)"/g)].map((m) => m[1])));
  components.forEach((name) => billing.includes(`\`${name}\``) || problems.push(`El tag Component=${name} no figura en ${BILLING}`));
  const tagKeys = new Set(environments.flatMap((env) => [...(/default_tags\s*\{\s*tags\s*=\s*\{([\s\S]*?)\}/.exec(hcl(`environments/${env}/providers.tf`))?.[1].matchAll(/^\s*(\w+)\s*=/gm) ?? [])].map((m) => m[1])));
  tagKeys.forEach((name) => billing.includes(`\`${name}\``) || problems.push(`El tag ${name} (default_tags) no figura en ${BILLING}`));
  for (const dir of [...modules.map((m) => `modules/${m}`), ...environments.map((e) => `environments/${e}`)]) {
    for (const v of variablesOf(dir)) {
      if (/token|secret|password|app_env_vars/i.test(v.name) && !v.sensitive) problems.push(`${dir}: la variable ${v.name} debería ser sensitive = true`);
    }
  }
  check('Etiquetas de costes y variables sensibles', problems);
}

{
  const problems = [];
  const patterns = [
    [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'un token de GitHub'],
    [/AKIA[0-9A-Z]{16}/, 'una clave de acceso de AWS'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'una clave privada'],
    [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/, 'un hash bcrypt'],
  ];
  const scanned = [...docFiles, ...tfFiles, ...walk('environments').filter((f) => f.endsWith('.example')), ...walk('scripts')];
  for (const file of scanned) {
    read(file).split('\n').forEach((line, index) => {
      for (const [pattern, what] of patterns) if (pattern.test(line)) problems.push(`${file}:${index + 1} parece contener ${what} (no se muestra el valor)`);
    });
  }
  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    tracked
      .filter((file) => /\.tfvars$|\.tfvars\.json$|\.tfstate/.test(file) && !file.endsWith('.example'))
      .forEach((file) => problems.push(`${file} está versionado y no debería estarlo`));
  } catch {
    warn('Secretos', ['No se pudo ejecutar git ls-files: no se comprobó que los .tfvars estén fuera del repositorio']);
  }
  const ignore = existsSync(join(ROOT, '.gitignore')) ? read('.gitignore') : '';
  for (const entry of ['terraform.tfvars', '*.tfstate']) ignore.includes(entry) || problems.push(`.gitignore no incluye ${entry}`);
  check('Secretos: ninguno en documentos ni plantillas, y tfvars fuera de git', problems);
}

// 9. Cifras en un solo documento ─────────────────────────────────────────────────────────────────
{
  const problems = [];
  const volatile = /\b\d{1,4}\s+(módulos|entornos|recursos|variables|outputs|archivos|claves|modules|environments|resources|files)\b/i;
  for (const [file, text] of Object.entries(docs)) {
    if (file === STATE || file === MAINTENANCE) continue;
    let inFence = false;
    text.split('\n').forEach((line, index) => {
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      if (!inFence && volatile.test(line)) problems.push(`${file}:${index + 1} repite una cifra que solo debe estar en ${STATE}`);
    });
  }
  const state = docs[STATE] ?? '';
  for (const [name, value] of Object.entries(metrics())) {
    const row = state.match(new RegExp(`^\\|\\s*${escapeRegExp(name)}\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'));
    if (!row) problems.push(`${STATE} no tiene la fila "${name}" con el formato | ${name} | N |`);
    else if (Number(row[1]) !== value) problems.push(`${STATE} dice ${row[1]} en "${name}" y el código tiene ${value}`);
  }
  check('Métricas (una sola fuente: estado-y-deuda-tecnica.md)', problems);
}

// ── Avisos frente a los repositorios hermanos (no hacen fallar salvo con --strict) ──────────────
const docAppKeys = namedRows(section(docs[REFERENCE], 'app_env_vars'));

{
  const file = join(BACKEND, 'config', 'validateEnv.js');
  const name = 'Backend: claves de app_env_vars frente a config/validateEnv.js';
  if (!existsSync(file)) warn(name, ['No existe ../sigmetum-backend/config/validateEnv.js: comprobación omitida']);
  else {
    const required = new Set([...(/const required = \[([\s\S]*?)\]/.exec(read('config/validateEnv.js', BACKEND))?.[1].matchAll(/'([A-Z0-9_]+)'/g) ?? [])].map((m) => m[1]));
    const documented = new Set(docAppKeys.map((row) => row[0]));
    const items = [
      ...setDiff(required, documented).map((key) => `El backend exige ${key} y no está en la tabla app_env_vars de la referencia`),
      ...docAppKeys.filter((row) => /^s[ií]/i.test(row[1]) && !required.has(row[0])).map((row) => `La referencia marca ${row[0]} como obligatoria y el backend ya no la exige`),
      ...docAppKeys.filter((row) => /^no/i.test(row[1]) && required.has(row[0])).map((row) => `La referencia marca ${row[0]} como opcional y el backend la exige`),
    ];
    if (required.size === 0) items.push('No se pudo leer la lista `required` de validateEnv.js');
    warn(name, items);
  }
}

{
  const file = join(FRONTEND, '.env.example');
  const name = 'Frontend: variables VITE_* de Amplify frente a .env.example';
  if (!existsSync(file)) warn(name, ['No existe ../sigmetum-frontend/.env.example: comprobación omitida']);
  else {
    const frontendKeys = new Set([...read('.env.example', FRONTEND).matchAll(/^#?\s*(VITE_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));
    const amplifyVite = new Set([...amplifyKeys].filter((key) => key.startsWith('VITE_')));
    warn(name, [
      ...setDiff(frontendKeys, amplifyVite).map((key) => `El frontend lee ${key} y modules/amplify no la define`),
      ...setDiff(amplifyVite, frontendKeys).map((key) => `modules/amplify define ${key} y el frontend no la lee`),
    ]);
  }
}

{
  const file = join(BACKEND, 'index.js');
  const name = 'Backend: health check de Beanstalk frente a la ruta del backend';
  if (!existsSync(file)) warn(name, ['No existe ../sigmetum-backend/index.js: comprobación omitida']);
  else {
    const route = /app\.(?:use|get)\(\s*'(\/healthcheck[^']*)'/.exec(read('index.js', BACKEND))?.[1];
    const path = /"HealthCheckPath"\s*value\s*=\s*"([^"]+)"/.exec(hcl('modules/beanstalk/main.tf').replace(/\s+/g, ' '))?.[1];
    warn(name, route && path && route !== path ? [`Beanstalk comprueba ${path} y el backend responde en ${route}`] : []);
  }
}

warn(
  'Contrato: URL del backend en Amplify',
  environments
    .filter((env) => /backend_url\s*=\s*"http:\/\//.test(hcl(`environments/${env}/main.tf`)))
    .map((env) => `environments/${env}: backend_url usa http://; Amplify sirve el frontend por HTTPS y el navegador bloquea el contenido mixto`)
);

warn(
  'Contrato: documento del frontend',
  existsSync(join(FRONTEND, 'docs', 'integracion', 'para-infra.md')) ? [] : ['No existe ../sigmetum-frontend/docs/integracion/para-infra.md: los enlaces de los documentos de integración a ese documento no se pueden comprobar']
);

// ── Informe ────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
for (const { name, problems } of results) {
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${name}`);
  problems.forEach((problem) => console.log(`    - ${problem}`));
  failed += problems.length;
}

let warned = 0;
if (warnings.some((w) => w.items.length > 0)) console.log('\nAvisos entre repositorios (revisa y deja constancia en la PR; ver docs/guias/mantenimiento.md):');
for (const { name, items } of warnings) {
  if (items.length === 0) continue;
  console.log(`⚠ ${name}`);
  items.forEach((item) => console.log(`    - ${item}`));
  warned += items.length;
}

if (strict) failed += warned;
console.log(
  failed === 0
    ? `\nLa documentación está al día.${warned ? ` (${warned} aviso(s) entre repositorios; con --strict fallarían)` : ''}`
    : `\n${failed} problema(s). Corrige la documentación (ver docs/guias/mantenimiento.md).`
);
process.exit(failed === 0 ? 0 : 1);
