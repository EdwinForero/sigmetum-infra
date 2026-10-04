# CI: sincronización de código con Elastic Beanstalk

**Fecha:** 2026-10-04  
**Repos afectados:** `sigmetum-backend` (workflow), `sigmetum-infra` (IAM — apply manual)  
**Estado:** borrador — pendiente de revisión

---

## 1. Objetivo

Que un push al repo del backend despliegue automáticamente el código en el entorno de Beanstalk correspondiente, igual que Amplify hace con el frontend. Terraform se sigue corriendo a mano; este pipeline solo sincroniza el código de la app.

## 2. Reglas de disparo

| Rama | Entorno EB |
|------|-----------|
| `feature/testing` | `sigmetum-backend-dev-env` (app `sigmetum-backend-dev`) |
| `master` | `sigmetum-backend-prod-env` (app `sigmetum-backend-prod`) |

El job `deploy` solo corre en eventos `push` (no en `pull_request`) y solo si `verify` pasa.

## 3. Flujo

```
push → verify → [si pasa] deploy
                  1. zip del código (sin node_modules, .env*, .git)
                  2. s3 cp → s3://{bucket}/{sha}.zip
                  3. elasticbeanstalk create-application-version  (si el label ya existe, se reutiliza)
                  4. elasticbeanstalk update-environment
                  5. wait environment-updated
```

El label de versión es el SHA de git. Si se hace push del mismo commit dos veces, el paso 3 detecta que el label ya existe y lo reutiliza sin error.

## 4. Autenticación con AWS: OIDC

Sin claves de larga duración en GitHub secrets. GitHub Actions asume un rol IAM via OIDC.

### 4a. OIDC provider — recurso de cuenta, se crea una sola vez

`aws_iam_openid_connect_provider` para `token.actions.githubusercontent.com` es un recurso **de cuenta AWS**, no de entorno. Se crea una única vez en un módulo separado (`modules/github-oidc-provider/`) y se instancia solo en uno de los entornos (o en un entorno `shared/` si se crea). Si ya existe en la cuenta, hay que importarlo antes del apply.

### 4b. Roles IAM — uno por entorno

| Rol | Trust restringido a |
|-----|-------------------|
| `sigmetum-backend-ci-dev` | `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/feature/testing` |
| `sigmetum-backend-ci-prod` | `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/master` |

Permisos mínimos, acotados a recursos exactos:

```
s3:PutObject     → arn:aws:s3:::sigmetum-backend-deploys-{env}/*
s3:GetObject     → arn:aws:s3:::sigmetum-backend-deploys-{env}/*

elasticbeanstalk:CreateApplicationVersion  → arn:aws:elasticbeanstalk:{region}:{account}:application/sigmetum-backend-{env}
elasticbeanstalk:UpdateEnvironment         → arn:aws:elasticbeanstalk:{region}:{account}:environment/sigmetum-backend-{env}/sigmetum-backend-{env}-env
elasticbeanstalk:DescribeEnvironments      → * (la API no admite scope por recurso)
elasticbeanstalk:DescribeEvents            → * (ídem)
```

## 5. Buckets de artefactos

Dos buckets nuevos, separados del bucket de contenido web:

- `sigmetum-backend-deploys-dev`
- `sigmetum-backend-deploys-prod`

Configuración: cifrado SSE-S3, bloqueo de acceso público activado, sin versionado (los zips son efímeros).

### Permiso para el rol de servicio de Beanstalk

Cuando GitHub Actions llama a `create-application-version`, Beanstalk descarga el zip usando `aws-elasticbeanstalk-service-role` — no el rol de CI. Ese rol de servicio necesita `s3:GetObject` sobre el bucket de deploys. Se añade una `aws_s3_bucket_policy` que lo permite:

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

## 6. Variables en GitHub Actions

| Variable (no secret) | Valor |
|----------------------|-------|
| `AWS_ROLE_DEV` | ARN de `sigmetum-backend-ci-dev` (output de Terraform) |
| `AWS_ROLE_PROD` | ARN de `sigmetum-backend-ci-prod` (output de Terraform) |
| `S3_BUCKET_DEV` | `sigmetum-backend-deploys-dev` |
| `S3_BUCKET_PROD` | `sigmetum-backend-deploys-prod` |

`AWS_REGION`, nombre de app EB y nombre de entorno EB van hardcodeados en el workflow.

## 7. Estructura Terraform

```
modules/
  github-oidc-provider/   ← nuevo: solo el aws_iam_openid_connect_provider
  backend-ci-iam/         ← nuevo: roles IAM + buckets de deploys + bucket policies
environments/
  dev/   ← instancia backend-ci-iam (roles + buckets dev)
  prod/  ← instancia backend-ci-iam (roles + buckets prod)
  # github-oidc-provider se instancia UNA SOLA VEZ, en dev o en un entorno shared/
```

## 8. Cambios en `sigmetum-backend`

- Job `deploy` en `.github/workflows/ci.yml` con `needs: verify`.
- Condición explícita `if: github.event_name == 'push'` para que no corra en PRs.
- Usa `aws-actions/configure-aws-credentials@v4` con `role-to-assume` (OIDC).

## 9. Recursos que deben existir antes de que el workflow funcione

| Recurso | Ya existe | Lo crea |
|---------|-----------|---------|
| Beanstalk app + env | Sí | `terraform apply` existente |
| OIDC provider de GitHub | **No** | `modules/github-oidc-provider` (una vez) |
| IAM role `sigmetum-backend-ci-dev` | **No** | `modules/backend-ci-iam` en dev |
| IAM role `sigmetum-backend-ci-prod` | **No** | `modules/backend-ci-iam` en prod |
| S3 `sigmetum-backend-deploys-dev` | **No** | `modules/backend-ci-iam` en dev |
| S3 `sigmetum-backend-deploys-prod` | **No** | `modules/backend-ci-iam` en prod |

## 10. Orden (primera puesta en marcha)

1. `terraform apply` en dev (crea OIDC provider + rol dev + bucket dev).
2. `terraform apply` en prod (crea rol prod + bucket prod — el OIDC provider ya existe).
3. Copiar ARN de outputs a variables de GitHub Actions del repo backend.
4. Push a `feature/testing` → verificar deploy a dev.
5. Push a `master` → verificar deploy a prod.
