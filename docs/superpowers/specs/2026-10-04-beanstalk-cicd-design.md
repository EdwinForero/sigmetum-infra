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

El deploy solo corre si el job `verify` pasa (lint, quality, docs:check).

## 3. Flujo

```
push → verify → [si pasa] deploy
                  1. zip del código (sin node_modules, .env*, .git)
                  2. s3 cp → s3://{bucket}/deploys/{sha}.zip
                  3. elasticbeanstalk create-application-version
                  4. elasticbeanstalk update-environment
                  5. wait environment-updated
```

## 4. Autenticación con AWS

OIDC — sin claves de larga duración en GitHub secrets. Un rol IAM por entorno con trust restringido a la rama exacta:

- `sigmetum-cicd-dev` → solo `ref:refs/heads/feature/testing`
- `sigmetum-cicd-prod` → solo `ref:refs/heads/master`

Permisos mínimos de cada rol:
- `s3:PutObject` sobre `{bucket}/deploys/*`
- `elasticbeanstalk:CreateApplicationVersion`
- `elasticbeanstalk:UpdateEnvironment`
- `elasticbeanstalk:DescribeEnvironments`
- `elasticbeanstalk:DescribeEvents`

Estos roles se crean **a mano con Terraform** (apply manual, una sola vez). El pipeline no toca Terraform.

## 5. Bucket de artefactos

Prefijo `deploys/` en el bucket existente (`sigmetum-app-assets-{env}`). Sin bucket nuevo.

## 6. Variables en GitHub Actions

| Variable (no secret) | Valor |
|----------------------|-------|
| `AWS_ROLE_DEV` | ARN de `sigmetum-cicd-dev` (output de Terraform) |
| `AWS_ROLE_PROD` | ARN de `sigmetum-cicd-prod` (output de Terraform) |
| `S3_BUCKET_DEV` | nombre del bucket dev |
| `S3_BUCKET_PROD` | nombre del bucket prod |

`AWS_REGION` va hardcoded en el workflow (`eu-west-3`).

## 7. Cambios por repositorio

### `sigmetum-infra` (apply manual, una vez)

- Nuevo módulo `modules/cicd-iam/`: `aws_iam_openid_connect_provider` (cuenta) + dos `aws_iam_role` con sus políticas.
- Outputs con los ARN de los roles para configurar las variables de GitHub.

### `sigmetum-backend`

- Añadir job `deploy` al `ci.yml` existente con `needs: verify`.

## 8. Orden (primera puesta en marcha)

1. `terraform apply` manual en infra para crear los roles OIDC.
2. Copiar los ARN de los outputs a las variables de GitHub Actions del repo backend.
3. Push a `feature/testing` → verificar deploy a dev.
4. Push a `master` → verificar deploy a prod.
