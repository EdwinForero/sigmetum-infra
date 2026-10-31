// Sube los recursos estáticos de la web (assets/…) al bucket de un entorno con `aws s3 sync`.
// Uso: node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket> --profile <perfil> [--region <región>] [--dryrun]
//      node scripts/sync-assets.mjs --help
// La carpeta de origen es el CONTENIDO de assets/ (logos/, banners/…); el destino es siempre s3://<bucket>/assets/.
// Nunca usa --delete: no borra nada del bucket. Sin --dryrun sube de verdad: ejecuta antes con --dryrun y revisa la salida.
// Necesita la AWS CLI v2 y la sesión abierta (aws sso login --profile <perfil>). Sin dependencias, sin valores por defecto de
// carpeta, bucket ni perfil, y sin leer credenciales ni terraform.tfvars. La subida real la hace una persona.

import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@+=,-]*$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

export const USAGE = `Uso: node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket> --profile <perfil> [--region <región>] [--dryrun]
  --source   carpeta con el contenido de assets/ (obligatoria)
  --bucket   nombre del bucket de S3 del entorno (obligatorio)
  --profile  perfil de AWS (obligatorio)
  --region   región, si el perfil no la define
  --dryrun   simula la subida sin escribir nada
  --help     muestra esta ayuda`;

export const parseOptions = (argv) => {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      source: { type: 'string' },
      bucket: { type: 'string' },
      profile: { type: 'string' },
      region: { type: 'string' },
      dryrun: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true };
  for (const name of ['source', 'bucket', 'profile']) if (!values[name]) throw new Error(`Falta --${name}.`);
  if (values.source.startsWith('-')) throw new Error('--source no es una ruta válida.');
  if (!BUCKET.test(values.bucket)) throw new Error('--bucket no parece un nombre de bucket de S3 válido.');
  if (!PROFILE.test(values.profile)) throw new Error('--profile contiene caracteres no permitidos.');
  if (values.region !== undefined && !REGION.test(values.region)) throw new Error('--region no parece una región de AWS válida.');
  const source = resolve(values.source);
  let stats;
  try {
    stats = statSync(source);
  } catch {
    throw new Error('La carpeta --source no existe.');
  }
  if (!stats.isDirectory()) throw new Error('--source debe ser una carpeta.');
  if (readdirSync(source).length === 0) throw new Error('La carpeta --source está vacía.');
  return { source, bucket: values.bucket, profile: values.profile, region: values.region, dryrun: values.dryrun };
};

export const buildArgs = ({ source, bucket, profile, region, dryrun }) => [
  's3',
  'sync',
  source,
  `s3://${bucket}/assets/`,
  '--profile',
  profile,
  ...(region ? ['--region', region] : []),
  ...(dryrun ? ['--dryrun'] : []),
];

export const main = async (argv, { run = execFileAsync, out = console.log, err = console.error } = {}) => {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    err(`Error: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }
  const args = buildArgs(options);
  out(`aws ${args.join(' ')}`);
  try {
    const { stdout, stderr } = await run('aws', args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (stdout) out(stdout.trimEnd());
    if (stderr) err(stderr.trimEnd());
    return 0;
  } catch (error) {
    if (error.code === 'ENOENT') err('No se encontró la AWS CLI (aws). Instálala y abre la sesión con aws sso login.');
    else {
      if (error.stdout) out(String(error.stdout).trimEnd());
      err(String(error.stderr || error.message).trimEnd());
    }
    return 1;
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
