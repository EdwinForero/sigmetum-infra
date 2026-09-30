// Puerta de calidad y seguridad de la infraestructura.
// Uso: node scripts/quality-check.mjs      (sale con código 1 si hay un problema nuevo)
// Comprueba: formato y validación de Terraform (si está instalado), escáneres opcionales (tflint, trivy, checkov),
// reglas estáticas sobre los .tf, secretos, archivos que no deben versionarse y coherencia con los repositorios hermanos.
// Nunca ejecuta apply, destroy, import ni comandos de AWS, y nunca lee terraform.tfvars ni imprime valores sensibles.
// Las reglas y su motivo están en docs/guias/buenas-practicas-terraform.md y docs/guias/seguridad.md.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = resolve(ROOT, '..', 'sigmetum-backend');
const FRONTEND = resolve(ROOT, '..', 'sigmetum-frontend');
const posix = (file) => file.split(sep).join('/');
const read = (file, base = ROOT) => readFileSync(join(base, file), 'utf8').replace(/\r\n/g, '\n');
const SKIP_DIRS = new Set(['.git', '.terraform', 'node_modules']);

const walk = (dir) =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = posix(join(dir, name));
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
const subdirs = (dir) => readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory() && !SKIP_DIRS.has(name)).sort();

const run = (command, args, cwd = ROOT, timeout = 240000) => spawnSync(command, args, { cwd, encoding: 'utf8', timeout });
const installed = (command) => !run(command, ['--version'], ROOT, 20000).error;

const results = [];
const check = (name, problems, notes = []) => results.push({ name, problems, notes });

// ── Excepciones aceptadas por escrito ──────────────────────────────────────────────────────────────
// Deuda conocida: incumplimientos de hoy, registrados en docs/estado-y-deuda-tecnica.md. Se listan para que
// no puedan extenderse a nada nuevo. Al resolver un hallazgo, se quita de aquí y se pasa a "Resueltos".
const KNOWN_DEBT = {
  // terraform fmt: archivos que hoy no pasan
  fmt: { 'environments/prod/main.tf': 'M4 (alineación del módulo dns; se corrige en un commit aparte)' },
  // .terraform.lock.hcl ignorado por git
  lockfileIgnored: 'M5 (la práctica recomendada es versionarlo)',
  // bloque backend "s3" sin cifrado explícito ni bloqueo de concurrencia
  stateBackend: { dev: 'S3', prod: 'S3' },
  // buckets: política TLS, registros de acceso y prevent_destroy
  buckets: {
    'modules/storage:app': { tls: 'S5', logging: 'S5', preventDestroy: 'M6' },
  },
  // recursos etiquetables sin la etiqueta Component
  untagged: { 'modules/amplify:aws_amplify_branch.this': 'M8' },
  // variables sin description (todas tienen type)
  noDescription: {
    id: 'M7',
    names: [
      'environments/dev:notification_email', 'environments/dev:bucket_name', 'environments/dev:ssl_certificate_arn',
      'environments/dev:github_access_token', 'environments/dev:github_repository', 'environments/dev:app_env_vars',
      'environments/prod:notification_email', 'environments/prod:bucket_name', 'environments/prod:github_access_token',
      'environments/prod:github_repository', 'environments/prod:app_env_vars',
      'modules/amplify:environment', 'modules/amplify:app_name',
      'modules/beanstalk:environment', 'modules/beanstalk:instance_type', 'modules/beanstalk:min_instances',
      'modules/beanstalk:max_instances', 'modules/beanstalk:vpc_id', 'modules/beanstalk:subnet_ids',
      'modules/beanstalk:load_balancer_type', 'modules/beanstalk:notification_email',
      'modules/networking:environment', 'modules/storage:environment',
    ],
  },
  // documentos que contienen identificadores de cuenta de AWS (no son secretos, pero se prefieren marcadores)
  accountIds: { 'docs/aws-cli-setup.md': 'S1', 'docs/aws-organizations-setup.md': 'S1' },
};

// Variables cuyo nombre parece un secreto pero no lo es.
const NOT_SECRET = { ssh_key_name: 'nombre del par de claves de EC2, no su contenido' };

// Recursos que admiten etiquetas y deben llevar Component (Project, Environment y ManagedBy llegan por default_tags).
const TAGGABLE = ['aws_amplify_app', 'aws_amplify_branch', 'aws_elastic_beanstalk_application', 'aws_elastic_beanstalk_environment', 'aws_s3_bucket'];

// ── Lectura de HCL ───────────────────────────────────────────────────────────────────────────────────
const stripComments = (text) => text.replace(/^\s*#.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
const blocks = (text, keyword) => {
  const out = [];
  const re = new RegExp(`^\\s*${keyword}\\s+"([^"]+)"(?:\\s+"([^"]+)")?\\s*\\{`, 'gm');
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

const allFiles = walk('.');
const tfFiles = allFiles.filter((file) => file.endsWith('.tf'));
const tf = Object.fromEntries(tfFiles.map((file) => [file, stripComments(read(file))]));
const dirOf = (file) => posix(dirname(file));
const environments = subdirs('environments');
const modules = subdirs('modules');

const resources = tfFiles.flatMap((file) => blocks(tf[file], 'resource').map((r) => ({ ...r, type: r.name, file, dir: dirOf(file) })));
const variables = tfFiles
  .filter((file) => file.endsWith('variables.tf'))
  .flatMap((file) => blocks(tf[file], 'variable').map((v) => ({ ...v, file, dir: dirOf(file), top: topLevel(v.body) })));
const outputs = tfFiles
  .filter((file) => file.endsWith('outputs.tf'))
  .flatMap((file) => blocks(tf[file], 'output').map((o) => ({ ...o, file, dir: dirOf(file), top: topLevel(o.body) })));

// ── 1. Terraform: formato y validación ────────────────────────────────────────────────────────────────
{
  const problems = [];
  const notes = [];
  if (!installed('terraform')) {
    notes.push('terraform no está instalado: no se comprobó el formato ni la validación (ver docs/terraform-setup.md).');
  } else {
    const fmt = run('terraform', ['fmt', '-check', '-recursive', '-list=true', '-no-color']);
    const unformatted = fmt.stdout.split('\n').map((line) => posix(line.trim())).filter(Boolean);
    for (const file of unformatted) {
      if (/\.tfvars$/.test(file) && !file.endsWith('.example')) notes.push(`${file} no tiene el formato canónico; está fuera de git y no cuenta`);
      else if (KNOWN_DEBT.fmt[file]) notes.push(`${file} sin formato: deuda conocida ${KNOWN_DEBT.fmt[file]}`);
      else problems.push(`${file} no pasa terraform fmt (ejecuta terraform fmt y revisa el diff)`);
    }
    for (const env of environments) {
      const dir = join(ROOT, 'environments', env);
      const init = run('terraform', ['init', '-backend=false', '-input=false', '-no-color'], dir);
      if (init.status !== 0) {
        const out = `${init.stdout}\n${init.stderr}`;
        if (/Failed to query available provider|Failed to install provider|dial tcp|no such host|i\/o timeout|registry\.terraform\.io/i.test(out)) {
          notes.push(`environments/${env}: terraform init no pudo descargar el proveedor (¿sin red?). Ejecuta la validación con conexión antes de fusionar.`);
        } else {
          problems.push(`environments/${env}: terraform init falla: ${out.split('\n').find((line) => /Error/.test(line))?.trim() ?? 'ver salida de terraform init'}`);
        }
        continue;
      }
      const validate = run('terraform', ['validate', '-no-color'], dir);
      if (validate.status !== 0) {
        const lines = `${validate.stdout}${validate.stderr}`.split('\n').filter((line) => /Error|on .* line/.test(line)).slice(0, 4);
        problems.push(`environments/${env}: terraform validate falla`, ...lines.map((line) => `    ${line.trim()}`));
      }
    }
  }
  check('Terraform: fmt -check -recursive y validate de cada entorno', problems, notes);
}

// ── 2. Escáneres opcionales ───────────────────────────────────────────────────────────────────────────
{
  const problems = [];
  const notes = [];
  const last = (text, n = 6) => text.split('\n').filter((line) => line.trim()).slice(-n);
  if (installed('tflint')) {
    const out = run('tflint', ['--recursive', '--no-color']);
    if (out.status !== 0) problems.push('tflint reporta problemas:', ...last(out.stdout + out.stderr, 12).map((line) => `    ${line.trim()}`));
    else notes.push('tflint: sin problemas');
  } else notes.push('tflint no está instalado. Recomendado: https://github.com/terraform-linters/tflint (errores de proveedor y malas prácticas).');
  if (installed('trivy')) {
    const out = run('trivy', ['config', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--quiet', '.']);
    if (out.status !== 0) problems.push('trivy config reporta problemas HIGH o CRITICAL:', ...last(out.stdout + out.stderr, 12).map((line) => `    ${line.trim()}`));
    else notes.push('trivy config: sin problemas HIGH ni CRITICAL');
  } else notes.push('trivy no está instalado. Recomendado: https://trivy.dev (trivy config analiza los .tf en busca de malas configuraciones).');
  if (installed('checkov')) {
    const out = run('checkov', ['-d', '.', '--framework', 'terraform', '--quiet', '--compact']);
    notes.push(`checkov (informativo): ${last(out.stdout, 2).join(' | ') || 'sin salida'}`);
  } else notes.push('checkov no está instalado. Recomendado: pip install checkov (revisión adicional de seguridad).');
  check('Escáneres opcionales (tflint, trivy, checkov)', problems, notes);
}

// ── 3. Reglas estáticas sobre los .tf ──────────────────────────────────────────────────────────────────
{
  const problems = [];
  const notes = [];

  // SSH abierto al mundo y puertos expuestos
  for (const { file, text } of tfFiles.map((f) => ({ file: f, text: tf[f] }))) {
    const segments = [
      ...blocks(text, 'resource').map((b) => ({ kind: `${b.name}.${b.label}`, body: b.body })),
      ...blocks(text, 'variable').map((b) => ({ kind: `variable.${b.name}`, body: b.body })),
      ...blocks(text, 'module').map((b) => ({ kind: `module.${b.name}`, body: b.body })),
    ];
    for (const { kind, body } of segments) {
      if (!/0\.0\.0\.0\/0|::\/0/.test(body)) continue;
      if (/\b22\b|ssh/i.test(body)) problems.push(`${file}: ${kind} abre SSH (puerto 22) a 0.0.0.0/0`);
      for (const [, port] of body.matchAll(/(?:from_port|to_port)\s*=\s*(\d+)/g)) {
        if (!['80', '443'].includes(port) && port !== '22') problems.push(`${file}: ${kind} expone el puerto ${port} a 0.0.0.0/0`);
      }
    }
    if (/SSHSourceRestriction[\s\S]{0,120}0\.0\.0\.0\/0/.test(text)) problems.push(`${file}: SSHSourceRestriction abierto a 0.0.0.0/0`);
    if (/Principal\s*=\s*"\*"|"Principal"\s*:\s*"\*"/.test(text)) problems.push(`${file}: política con Principal "*"`);
    if (/Action\s*=\s*(?:"\*"|"[a-z0-9]+:\*"|\["\*"\])/i.test(text)) problems.push(`${file}: política IAM con Action comodín (*)`);
    if (/provisioner\s+"|null_resource|local-exec|remote-exec/.test(text)) problems.push(`${file}: usa provisioner o null_resource (ver docs/guias/buenas-practicas-terraform.md)`);
  }
  for (const v of variables.filter((x) => x.name === 'ssh_allowed_cidrs')) {
    if (/0\.0\.0\.0\/0/.test(v.top)) problems.push(`${v.file}: el valor por defecto de ssh_allowed_cidrs incluye 0.0.0.0/0`);
  }
  for (const v of variables.filter((x) => x.name === 'ssh_key_name')) {
    if (/default\s*=\s*"[^"]+"/.test(v.top)) problems.push(`${v.file}: ssh_key_name tiene un valor por defecto; SSH debe estar cerrado por defecto`);
  }

  // Buckets de S3
  for (const bucket of resources.filter((r) => r.type === 'aws_s3_bucket')) {
    const key = `${bucket.dir}:${bucket.label}`;
    const related = (type) => resources.filter((r) => r.type === type && r.dir === bucket.dir && r.body.includes(`aws_s3_bucket.${bucket.label}.`));
    const pab = related('aws_s3_bucket_public_access_block')[0];
    const flags = ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'];
    if (!pab || !flags.every((flag) => new RegExp(`${flag}\\s*=\\s*true`).test(pab.body))) {
      problems.push(`${key}: el bucket no tiene aws_s3_bucket_public_access_block con los cuatro bloqueos en true`);
    }
    if (related('aws_s3_bucket_server_side_encryption_configuration').length === 0) problems.push(`${key}: el bucket no tiene cifrado en reposo`);
    if (!related('aws_s3_bucket_versioning').some((r) => /status\s*=\s*"Enabled"/.test(r.body))) problems.push(`${key}: el bucket no tiene versionado activado`);
    const debt = KNOWN_DEBT.buckets[key] ?? {};
    const soft = [
      ['tls', related('aws_s3_bucket_policy').some((r) => /aws:SecureTransport/.test(r.body)), 'sin política que exija TLS (aws:SecureTransport)'],
      ['logging', related('aws_s3_bucket_logging').length > 0, 'sin registros de acceso'],
      ['preventDestroy', /prevent_destroy\s*=\s*true/.test(bucket.body), 'sin prevent_destroy'],
    ];
    for (const [rule, ok, text] of soft) {
      if (ok) continue;
      if (debt[rule]) notes.push(`${key} ${text}: deuda conocida ${debt[rule]}`);
      else problems.push(`${key} ${text} (ver docs/guias/seguridad.md)`);
    }
  }

  // Variables y outputs
  const secretName = /password|secret|token|key|credential|env_vars/i;
  let undescribed = 0;
  for (const v of variables) {
    const id = `${v.dir}:${v.name}`;
    if (!/^\s*type\s*=/m.test(v.top)) problems.push(`${id} no tiene type`);
    if (!/^\s*description\s*=/m.test(v.top)) {
      if (KNOWN_DEBT.noDescription.names.includes(id)) undescribed++;
      else problems.push(`${id} no tiene description`);
    }
    if (secretName.test(v.name) && !NOT_SECRET[v.name] && !/^\s*sensitive\s*=\s*true/m.test(v.top)) problems.push(`${id} parece un secreto y no es sensitive = true`);
  }
  if (undescribed) notes.push(`${undescribed} variable(s) sin description: deuda conocida ${KNOWN_DEBT.noDescription.id}`);
  for (const o of outputs) {
    const id = `${o.dir}:output ${o.name}`;
    if (secretName.test(o.name) && !/^\s*sensitive\s*=\s*true/m.test(o.top)) problems.push(`${id} parece un secreto y no es sensitive = true`);
    if (/var\.(?:app_env_vars|\w*(?:token|secret|password)\w*)/i.test(o.body) && !/^\s*sensitive\s*=\s*true/m.test(o.top)) problems.push(`${id} expone una variable sensible sin sensitive = true`);
  }
  const knownStale = KNOWN_DEBT.noDescription.names.filter((id) => {
    const [dir, name] = id.split(':');
    const v = variables.find((x) => x.dir === dir && x.name === name);
    return !v || /^\s*description\s*=/m.test(v.top);
  });
  knownStale.forEach((id) => problems.push(`${id} ya no es deuda: quítala de KNOWN_DEBT.noDescription y pásala a "Resueltos"`));

  // Versiones de proveedores y de Terraform
  for (const file of tfFiles.filter((f) => /required_providers/.test(tf[f]))) {
    for (const [, name, body] of tf[file].matchAll(/(\w+)\s*=\s*\{([^{}]*source[^{}]*)\}/g)) {
      const version = /version\s*=\s*"([^"]+)"/.exec(body)?.[1];
      if (!version) problems.push(`${file}: el proveedor ${name} no tiene version`);
      else if (!/~>|<|,/.test(version)) problems.push(`${file}: la versión de ${name} ("${version}") no tiene límite superior; usa un rango acotado (~>)`);
    }
    if (!/required_version\s*=/.test(tf[file])) problems.push(`${file}: falta required_version`);
  }

  // Etiquetas
  for (const r of resources.filter((x) => TAGGABLE.includes(x.type))) {
    const key = `${r.dir}:${r.type}.${r.label}`;
    if (/Component\s*=/.test(r.body)) continue;
    if (KNOWN_DEBT.untagged[key]) notes.push(`${key} sin etiqueta Component: deuda conocida ${KNOWN_DEBT.untagged[key]}`);
    else problems.push(`${key} no tiene la etiqueta Component`);
  }
  for (const env of environments) {
    const tags = /default_tags\s*\{\s*tags\s*=\s*\{([\s\S]*?)\}/.exec(tf[`environments/${env}/providers.tf`] ?? '')?.[1] ?? '';
    for (const tag of ['Project', 'Environment', 'ManagedBy']) if (!new RegExp(`\\b${tag}\\s*=`).test(tags)) problems.push(`environments/${env}/providers.tf: default_tags no incluye ${tag}`);
  }

  // Estado remoto
  for (const env of environments) {
    const backend = tf[`environments/${env}/backend.tf`] ?? '';
    if (!/backend\s+"s3"/.test(backend)) {
      problems.push(`environments/${env}: no usa backend remoto en S3`);
      continue;
    }
    const encrypted = /encrypt\s*=\s*true/.test(backend);
    const locking = /use_lockfile\s*=\s*true|dynamodb_table\s*=/.test(backend);
    if (!encrypted || !locking) {
      const missing = [!encrypted && 'encrypt = true', !locking && 'bloqueo (use_lockfile o dynamodb_table)'].filter(Boolean).join(' y ');
      if (KNOWN_DEBT.stateBackend[env]) notes.push(`environments/${env}/backend.tf sin ${missing}: deuda conocida ${KNOWN_DEBT.stateBackend[env]}`);
      else problems.push(`environments/${env}/backend.tf sin ${missing}`);
    }
  }
  check('Reglas estáticas de los .tf (red, S3, variables, versiones, etiquetas, estado)', problems, notes);
}

// ── 4. Secretos y archivos que no deben versionarse ───────────────────────────────────────────────────
{
  const problems = [];
  const notes = [];
  const patterns = [
    [/AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}/, 'una clave de acceso de AWS'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'una clave privada'],
    [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'un token de GitHub'],
    [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/, 'un hash bcrypt'],
    [/arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/, 'un ARN con identificador de cuenta'],
  ];
  const scanned = allFiles.filter((f) => /\.(tf|md|mjs|example)$/.test(f) || f === '.gitignore');
  for (const file of scanned) {
    let accountIdLines = 0;
    read(file).split('\n').forEach((line, index) => {
      for (const [pattern, what] of patterns) if (pattern.test(line)) problems.push(`${file}:${index + 1} parece contener ${what} (no se muestra el valor)`);
      if (/\b\d{12}\b/.test(line) && !/^\s*(?:\/\/|#).*\bhttps?:/.test(line)) accountIdLines++;
    });
    if (accountIdLines > 0) {
      if (KNOWN_DEBT.accountIds[file]) notes.push(`${file} tiene ${accountIdLines} línea(s) con identificadores de cuenta: deuda conocida ${KNOWN_DEBT.accountIds[file]}`);
      else problems.push(`${file} tiene ${accountIdLines} línea(s) con un número de 12 dígitos (¿identificador de cuenta?); usa un marcador`);
    }
  }

  const listed = run('git', ['ls-files']);
  if (listed.status !== 0) notes.push('No se pudo ejecutar git ls-files: no se comprobaron los archivos versionados.');
  else {
    const tracked = listed.stdout.split('\n').filter(Boolean);
    const forbidden = /(^|\/)terraform\.tfvars(\.json)?$|\.auto\.tfvars|\.tfstate|(^|\/)\.terraform\/|\.pem$|\.key$|(^|\/)\.env(\.|$)/;
    tracked.filter((f) => forbidden.test(f) && !f.endsWith('.example')).forEach((f) => problems.push(`${f} está versionado y no debería estarlo`));
    const ignore = existsSync(join(ROOT, '.gitignore')) ? read('.gitignore') : '';
    for (const entry of ['terraform.tfvars', '*.tfstate', '.terraform/']) if (!ignore.includes(entry)) problems.push(`.gitignore no incluye ${entry}`);
    const lockIgnored = ignore.includes('.terraform.lock.hcl');
    const locks = tracked.filter((f) => f.endsWith('.terraform.lock.hcl'));
    if (lockIgnored) notes.push(`.terraform.lock.hcl está en .gitignore: deuda conocida ${KNOWN_DEBT.lockfileIgnored}`);
    else if (locks.length < environments.length) problems.push('.terraform.lock.hcl debe versionarse en cada entorno (terraform init y git add)');
  }
  check('Secretos y archivos que no deben versionarse', problems, notes);
}

// ── 5. Coherencia con los repositorios hermanos (avisos; no hacen fallar) ─────────────────────────────
{
  const notes = [];
  const exampleKeys = (env) => {
    const file = `environments/${env}/terraform.tfvars.example`;
    const block = /^app_env_vars\s*=\s*\{([\s\S]*?)^\}/m.exec(existsSync(join(ROOT, file)) ? stripComments(read(file)) : '');
    return new Set([...(block?.[1].matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*=/gm) ?? [])].map((m) => m[1]));
  };
  const validate = join(BACKEND, 'config', 'validateEnv.js');
  if (!existsSync(validate)) notes.push('No existe ../sigmetum-backend/config/validateEnv.js: comprobación de app_env_vars omitida.');
  else {
    const required = [...(/const required = \[([\s\S]*?)\]/.exec(read('config/validateEnv.js', BACKEND))?.[1].matchAll(/'([A-Z0-9_]+)'/g) ?? [])].map((m) => m[1]);
    if (required.length === 0) notes.push('No se pudo leer la lista required de validateEnv.js.');
    for (const env of environments) {
      const keys = exampleKeys(env);
      required.filter((key) => !keys.has(key)).forEach((key) => notes.push(`AVISO environments/${env}/terraform.tfvars.example no define ${key}, que el backend exige al arrancar`));
      [...keys].filter((key) => !required.includes(key) && !['PORT'].includes(key)).forEach((key) => notes.push(`AVISO environments/${env}/terraform.tfvars.example define ${key}, que el backend no exige (¿sobra?)`));
    }
  }
  const envExample = join(FRONTEND, '.env.example');
  if (!existsSync(envExample)) notes.push('No existe ../sigmetum-frontend/.env.example: comprobación de VITE_* omitida.');
  else {
    const frontend = new Set([...read('.env.example', FRONTEND).matchAll(/^#?\s*(VITE_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));
    const amplify = new Set([...(tf['modules/amplify/main.tf'] ?? '').matchAll(/^\s*(VITE_[A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));
    [...frontend].filter((key) => !amplify.has(key)).forEach((key) => notes.push(`AVISO el frontend lee ${key} y modules/amplify no la define (C1)`));
    [...amplify].filter((key) => !frontend.has(key)).forEach((key) => notes.push(`AVISO modules/amplify define ${key} y el frontend no la lee (C1)`));
  }
  check('Coherencia con el frontend y el backend (avisos)', [], notes);
}

// ── Informe ─────────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
for (const { name, problems, notes } of results) {
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${name}`);
  problems.forEach((problem) => console.log(`    - ${problem}`));
  notes.forEach((note) => console.log(`    · ${note}`));
  failed += problems.filter((problem) => !problem.startsWith('    ')).length;
}
console.log(failed === 0 ? '\nCalidad y seguridad: sin problemas nuevos.' : `\n${failed} problema(s). Ver docs/guias/seguridad.md y docs/guias/buenas-practicas-terraform.md.`);
process.exit(failed === 0 ? 0 : 1);
