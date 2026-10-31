// Pruebas de scripts/sync-assets.mjs. No tocan AWS: `run` es una función falsa que guarda los argumentos.
// Uso: node --test scripts/sync-assets.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { main } from './sync-assets.mjs';

const BUCKET = 'sigmetum-test-bucket';
const PROFILE = 'test-profile';

let base;
let source;
let emptyDir;
let filePath;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'sync-assets-'));
  source = join(base, 'assets');
  emptyDir = join(base, 'vacia');
  filePath = join(base, 'fichero.txt');
  mkdirSync(source);
  mkdirSync(emptyDir);
  writeFileSync(join(source, 'logo.png'), 'x');
  writeFileSync(filePath, 'x');
});

after(() => rmSync(base, { recursive: true, force: true }));

const exec = async (argv, run) => {
  const calls = [];
  const lines = { out: [], err: [] };
  const fake = run ?? (async (...call) => {
    calls.push(call);
    return { stdout: '', stderr: '' };
  });
  const tracked = async (...call) => {
    if (run) calls.push(call);
    return fake(...call);
  };
  const code = await main(argv, {
    run: run ? tracked : fake,
    out: (text) => lines.out.push(text),
    err: (text) => lines.err.push(text),
  });
  return { code, calls, lines };
};

const valid = () => ['--source', source, '--bucket', BUCKET, '--profile', PROFILE];

describe('sync-assets', () => {
  test('1. --help devuelve 0, imprime el uso y no llama a run', async () => {
    const { code, calls, lines } = await exec(['--help']);
    assert.equal(code, 0);
    assert.match(lines.out.join('\n'), /Uso:/);
    assert.equal(calls.length, 0);
  });

  test('2 a 4. falta --source, --bucket o --profile devuelve 2', async () => {
    for (const name of ['--source', '--bucket', '--profile']) {
      const argv = valid();
      const i = argv.indexOf(name);
      argv.splice(i, 2);
      const { code, calls } = await exec(argv);
      assert.equal(code, 2, name);
      assert.equal(calls.length, 0, name);
    }
  });

  test('5. bucket con mayúsculas, con ; o con s3:// devuelve 2', async () => {
    for (const bucket of ['Sigmetum-Bucket', 'bucket;rm', 's3://sigmetum-test-bucket']) {
      const { code, calls } = await exec(['--source', source, '--bucket', bucket, '--profile', PROFILE]);
      assert.equal(code, 2, bucket);
      assert.equal(calls.length, 0, bucket);
    }
  });

  test('6. perfil que empieza por - devuelve 2', async () => {
    const { code, calls } = await exec(['--source', source, '--bucket', BUCKET, '--profile=-evil']);
    assert.equal(code, 2);
    assert.equal(calls.length, 0);
  });

  test('7. origen inexistente, fichero o vacío devuelve 2', async () => {
    for (const bad of [join(base, 'no-existe'), filePath, emptyDir]) {
      const { code, calls } = await exec(['--source', bad, '--bucket', BUCKET, '--profile', PROFILE]);
      assert.equal(code, 2, bad);
      assert.equal(calls.length, 0, bad);
    }
  });

  test('8. --delete y un argumento posicional extra devuelven 2', async () => {
    for (const extra of [['--delete'], ['sobra']]) {
      const { code, calls } = await exec([...valid(), ...extra]);
      assert.equal(code, 2, extra.join(' '));
      assert.equal(calls.length, 0, extra.join(' '));
    }
  });

  test('9. llamada válida: run recibe aws y los argumentos exactos', async () => {
    const { code, calls } = await exec(valid());
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'aws');
    assert.deepEqual(calls[0][1], ['s3', 'sync', resolve(source), `s3://${BUCKET}/assets/`, '--profile', PROFILE]);
  });

  test('10. con --dryrun el array termina en --dryrun', async () => {
    const { code, calls } = await exec([...valid(), '--dryrun']);
    assert.equal(code, 0);
    assert.equal(calls[0][1].at(-1), '--dryrun');
  });

  test('11. --delete no aparece nunca', async () => {
    for (const extra of [[], ['--dryrun'], ['--region', 'eu-west-3']]) {
      const { calls } = await exec([...valid(), ...extra]);
      assert.ok(!calls[0][1].includes('--delete'));
    }
  });

  test('12. run que lanza ENOENT hace que main devuelva 1', async () => {
    const run = async () => {
      throw Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' });
    };
    const { code, lines } = await exec(valid(), run);
    assert.equal(code, 1);
    assert.match(lines.err.join('\n'), /AWS CLI/);
  });

  test('13. run que falla con stderr hace que main devuelva 1', async () => {
    const run = async () => {
      throw Object.assign(new Error('fallo'), { stderr: 'fatal error: acceso denegado' });
    };
    const { code, lines } = await exec(valid(), run);
    assert.equal(code, 1);
    assert.match(lines.err.join('\n'), /acceso denegado/);
  });
});
