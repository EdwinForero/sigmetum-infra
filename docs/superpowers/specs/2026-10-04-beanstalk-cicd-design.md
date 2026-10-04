# CI: sincronización de código con Elastic Beanstalk

**Fecha:** 2026-10-04  
**Repos afectados:** `sigmetum-backend` (workflow), `sigmetum-infra` (IAM — apply manual)  
**Estado:** borrador — pendiente de revisión

---

## 1. Objetivo

Que un push al repo del backend despliegue automáticamente el código en el entorno de Beanstalk correspondiente. Terraform se sigue corriendo a mano; este pipeline solo sincroniza el código de la app.

## 2. Cuentas AWS

Dev y prod son **cuentas AWS separadas**. Todo recurso creado en `environments/dev/` vive en la cuenta dev; todo lo de `environments/prod/` en la cuenta prod. No hay recursos compartidos entre cuentas.

## 3. Reglas de disparo

| Rama | Entorno EB | Cuenta AWS |
|------|-----------|------------|
| `feature/testing` | `sigmetum-backend-dev-env` | dev |
| `master` | `sigmetum-backend-prod-env` | prod |

El job `deploy` solo corre en eventos `push` (no en `pull_request`) y solo si `verify` pasa.

## 4. Flujo

```
push → verify → [si pasa] deploy
                  1. zip del código (sin node_modules, .env*, .git)
                  2. s3 cp → s3://{bucket}/{sha}.zip
                  3. elasticbeanstalk create-application-version  (reutiliza si el label ya existe)
                  4. elasticbeanstalk update-environment
                  5. wait environment-updated
```

El label de versión es el SHA de git. Re-push del mismo commit no falla — se reutiliza la versión existente.

## 5. Autenticación con AWS: OIDC

Sin claves de larga duración. GitHub Actions asume un rol IAM via OIDC.

El `aws_iam_openid_connect_provider` es un recurso de cuenta. Como dev y prod son cuentas separadas, se crea una vez en cada una — no hay conflicto. Va dentro de `modules/backend-ci-iam/` junto con el rol y el bucket.

| Rol | Cuenta | Trust restringido a |
|-----|--------|-------------------|
| `sigmetum-backend-ci-dev` | dev | `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/feature/testing` |
| `sigmetum-backend-ci-prod` | prod | `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/master` |

Permisos del rol, acotados a recursos exactos:

```
s3:PutObject    → arn:aws:s3:::sigmetum-backend-deploys-{env}/*
s3:GetObject    → arn:aws:s3:::sigmetum-backend-deploys-{env}/*
elasticbeanstalk:CreateApplicationVersion → arn:...:application/sigmetum-backend-{env}
elasticbeanstalk:UpdateEnvironment        → arn:...:environment/sigmetum-backend-{env}/sigmetum-backend-{env}-env
elasticbeanstalk:DescribeEnvironments     → * (la API no admite scope por recurso)
elasticbeanstalk:DescribeEvents           → * (ídem)
```

## 6. Buckets de artefactos

Un bucket por cuenta, dedicado a los zips de despliegue:

- cuenta dev → `sigmetum-backend-deploys-dev`
- cuenta prod → `sigmetum-backend-deploys-prod`

Configuración: cifrado SSE-S3, bloqueo de acceso público, sin versionado.

El rol de servicio de Beanstalk (`aws-elasticbeanstalk-service-role`) necesita `s3:GetObject` sobre el bucket para descargar el zip. Se añade una `aws_s3_bucket_policy`:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "elasticbeanstalk.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::sigmetum-backend-deploys-{env}/*",
  "Condition": {
    "StringEquals": { "aws:SourceAccount": "{account_id}" }
  }
}
```

## 7. Estructura Terraform

```
modules/
  backend-ci-iam/   ← nuevo: OIDC provider + rol IAM + bucket de deploys + bucket policy
environments/
  dev/   ← instancia backend-ci-iam → crea todo en la cuenta dev
  prod/  ← instancia backend-ci-iam → crea todo en la cuenta prod
```

No hay módulo separado para el OIDC provider: al ser cuentas distintas, el módulo se instancia de forma independiente en cada entorno sin colisión.

## 8. Variables en GitHub Actions

| Variable (no secret) | Valor |
|----------------------|-------|
| `AWS_ROLE_DEV` | ARN de `sigmetum-backend-ci-dev` (output de Terraform, cuenta dev) |
| `AWS_ROLE_PROD` | ARN de `sigmetum-backend-ci-prod` (output de Terraform, cuenta prod) |
| `S3_BUCKET_DEV` | `sigmetum-backend-deploys-dev` |
| `S3_BUCKET_PROD` | `sigmetum-backend-deploys-prod` |

`AWS_REGION`, nombre de app EB y nombre de entorno EB van hardcodeados en el workflow.

## 9. Cambios en `sigmetum-backend`

- Job `deploy` en `.github/workflows/ci.yml` con `needs: verify`.
- `if: github.event_name == 'push'` para que no corra en PRs.
- `aws-actions/configure-aws-credentials@v4` con `role-to-assume` (OIDC).

## 10. Recursos que deben existir antes de que el workflow funcione

| Recurso | Ya existe | Lo crea |
|---------|-----------|---------|
| Beanstalk app + env (ambas cuentas) | Sí | `terraform apply` existente |
| OIDC provider (cuenta dev) | **No** | `backend-ci-iam` en `environments/dev/` |
| OIDC provider (cuenta prod) | **No** | `backend-ci-iam` en `environments/prod/` |
| Rol + bucket (cuenta dev) | **No** | `backend-ci-iam` en `environments/dev/` |
| Rol + bucket (cuenta prod) | **No** | `backend-ci-iam` en `environments/prod/` |

## 11. Orden (primera puesta en marcha)

1. `terraform apply` en `environments/dev/` → crea OIDC provider, rol y bucket en la cuenta dev.
2. `terraform apply` en `environments/prod/` → ídem en la cuenta prod.
3. Copiar ARN de outputs a variables de GitHub Actions del repo backend.
4. Push a `feature/testing` → verificar deploy a dev.
5. Push a `master` → verificar deploy a prod.
