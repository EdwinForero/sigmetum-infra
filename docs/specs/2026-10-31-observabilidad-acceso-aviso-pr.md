# Aviso para PR: registros de acceso de S3 (D1)

Fecha: 2026-10-31 · Spec: `docs/specs/2026-10-31-observabilidad-acceso-design.md` · Plan: `docs/specs/2026-10-31-observabilidad-acceso-plan.md`

Integración: sin impacto — no cambian `app_env_vars`, el `build_spec`, las variables `VITE_*`, los dominios, la región, el bucket de datos como contrato (nombre, política `cloudfront_oac`, acceso por OAC) ni los permisos del rol de CI o de las instancias; solo se añade un bucket de logs y el logging de dos buckets, y los documentos de `docs/integracion/` no cambian.

## Qué cambia

- `modules/storage`: bucket de logs de acceso por entorno (`sigmetum-access-logs-<entorno>`, bloqueo público, cifrado AES256, versionado, `prevent_destroy`, política con `Deny` de TLS y entrega solo para `logging.s3.amazonaws.com`, expiración a los noventa días), `aws_s3_bucket_logging.app` sobre el bucket de datos (prefijo `app-data/`) y el output `access_logs_bucket_name`.
- `modules/backend-ci-iam`: variable obligatoria `access_logs_bucket_name` y `aws_s3_bucket_logging.eb_staging` sobre el bucket de staging de Beanstalk (prefijo `beanstalk-staging/`), que Terraform no crea.
- `environments/dev` y `environments/prod`: pasan `module.storage.access_logs_bucket_name` a `backend_ci_iam`, igual en ambos.
- `scripts/quality-check.mjs`: solo datos de `KNOWN_DEBT.buckets` (sale `modules/storage:app` y la entrada obsoleta `modules/backend-ci-iam:deploys`; entra `modules/storage:access_logs`, M15).

## Qué deben hacer los otros repositorios

Nada. Backend y frontend no necesitan cambiar ni desplegar.

## Orden de despliegue

1. Humano: `plan` y `apply` de Terraform en `dev`.
2. Comprobar que aparecen los logs (ver verificación posterior).
3. Después, `plan` y `apply` en `prod`.

## Qué mirar en el `plan`

1. Solo creaciones: los recursos del bucket de logs, `aws_s3_bucket_logging.app` y `aws_s3_bucket_logging.eb_staging`. Ningún destroy ni replace; `aws_s3_bucket.app` y su política `cloudfront_oac` sin cambios.
2. `aws_s3_bucket_logging.eb_staging` se crea sobre un bucket que Terraform no gestiona (no hace falta `import`; se sobrescribe cualquier configuración de logs que tuviera).
3. Que el nombre `sigmetum-access-logs-<entorno>` no choque con un bucket existente (los nombres son globales; si estuviera tomado, el `apply` fallaría, por confirmar).
4. La identidad que hace el `apply` necesita `s3:PutBucketLogging` sobre el bucket de staging.

## Verificación posterior (por confirmar)

- Pasadas unas horas deben aparecer objetos en `app-data/` y en `beanstalk-staging/` del bucket de logs **(por confirmar)**; la entrega es de mejor esfuerzo y con retraso.
- Que el `Deny` de `aws:SecureTransport` del bucket de logs no bloquee la entrega es una inferencia (la entrega de S3 usa HTTPS) **(por confirmar)**.

## Riesgos

1. Cuenta nueva sin el bucket de staging (Beanstalk aún sin desplegar): el `apply` de `eb_staging` falla con `NoSuchBucket`; desplegar Beanstalk antes.
2. Los logs contienen IP de visitantes y claves de objeto: mismo cifrado y bloqueo que el resto; retención de noventa días.
3. `prevent_destroy` en el bucket de logs: retirar un entorno exige decidirlo expresamente. Un `destroy` futuro de `eb_staging` desactivaría los logs de un bucket que Terraform no posee.
4. Entrega de mejor esfuerzo: si la política de entrega estuviera mal, no hay error en el `apply` y solo se nota por la ausencia de objetos.
5. La política de entrega lista dos buckets de origen: un tercero exigiría ampliarla.
