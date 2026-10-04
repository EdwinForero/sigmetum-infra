# CI/CD para Elastic Beanstalk (backend)

**Fecha:** 2026-10-04  
**Repos afectados:** `sigmetum-backend` (workflow), `sigmetum-infra` (IAM/OIDC)  
**Estado:** borrador — pendiente de revisión

---

## 1. Objetivo

Automatizar el despliegue del backend en Elastic Beanstalk desde GitHub Actions, de la misma forma que Amplify despliega el frontend automáticamente. Push a `feature/testing` → entorno dev. Push a `master` → entorno prod.

## 2. Reglas de disparo

| Evento | Entorno EB | Aplicación EB | Entorno EB |
|--------|-----------|---------------|------------|
| push a `feature/testing` | dev | `sigmetum-backend-dev` | `sigmetum-backend-dev-env` |
| push a `master` | prod | `sigmetum-backend-prod` | `sigmetum-backend-prod-env` |

El job de deploy solo corre **si el job `verify` (CI) pasa**. Un push que rompa lint o calidad no llega a desplegarse.

## 3. Flujo de despliegue

```
push → verify (lint, quality, docs:check)
            └── [solo si pasa] deploy
                  1. zip del código fuente (sin node_modules, sin .env*)
                  2. aws s3 cp   → s3://{bucket}/deploys/{sha}.zip
                  3. aws elasticbeanstalk create-application-version
                  4. aws elasticbeanstalk update-environment
                  5. aws elasticbeanstalk wait environment-updated
```

El zip excluye: `node_modules/`, `.git/`, `*.env*`, `.claude/`, `docs/superpowers/`.

## 4. Autenticación con AWS: OIDC

No se usan claves de larga duración (`AWS_ACCESS_KEY_ID`). GitHub Actions asume un rol IAM via OIDC:

- Se crea un `aws_iam_openid_connect_provider` para `token.actions.githubusercontent.com` (recurso de cuenta, va en `environments/shared/` o en cada entorno).
- Se crean dos roles IAM (`sigmetum-cicd-dev`, `sigmetum-cicd-prod`) con trust policy restringida al repo y rama exactos:
  - dev: `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/feature/testing`
  - prod: `repo:edwinmenfor2000/sigmetum-backend:ref:refs/heads/master`
- Permisos mínimos de cada rol:
  - `s3:PutObject` / `s3:GetObject` sobre `arn:aws:s3:::{bucket}/deploys/*`
  - `elasticbeanstalk:CreateApplicationVersion`
  - `elasticbeanstalk:UpdateEnvironment`
  - `elasticbeanstalk:DescribeEnvironments` (para el wait)
  - `elasticbeanstalk:DescribeEvents` (para el wait)

## 5. Bucket de artefactos

Se usa el bucket existente (`sigmetum-app-assets-{env}`) con el prefijo `deploys/`. No se crea un bucket nuevo. La política IAM de `modules/storage` ya da al rol EC2 acceso al bucket completo; el rol CICD solo necesita `PutObject` en `deploys/*`.

Alternativa descartada: bucket separado. Añade coste y complejidad sin beneficio real a esta escala.

## 6. Variables de GitHub Actions

No hay secrets de AWS (OIDC los reemplaza). Solo variables de entorno en el workflow:

| Variable / secret en GitHub | Valor | Quién la define |
|-----------------------------|-------|----------------|
| `AWS_ROLE_DEV` | ARN del rol `sigmetum-cicd-dev` | GitHub Actions variable (no secret) |
| `AWS_ROLE_PROD` | ARN del rol `sigmetum-cicd-prod` | GitHub Actions variable (no secret) |
| `AWS_REGION` | `eu-west-3` | hardcoded en el workflow |
| `S3_BUCKET_DEV` | nombre del bucket dev | GitHub Actions variable |
| `S3_BUCKET_PROD` | nombre del bucket prod | GitHub Actions variable |

Los ARN de los roles son outputs de Terraform (no secretos: no contienen credenciales).

## 7. Cambios por repositorio

### `sigmetum-infra`

1. Nuevo recurso `aws_iam_openid_connect_provider` para GitHub OIDC.  
   — Va en un módulo nuevo `modules/cicd-iam/` o directamente en `environments/dev/` y `environments/prod/`.  
   — El provider OIDC es de cuenta (no por entorno), así que lo más limpio es un módulo compartido instanciado una sola vez.

2. Dos recursos `aws_iam_role` (`sigmetum-cicd-dev`, `sigmetum-cicd-prod`) con sus políticas mínimas.

3. Outputs en cada entorno con el ARN del rol (para configurar las variables de GitHub Actions).

4. Actualizar `docs/integracion/para-backend.md` sección 9 para reflejar los nuevos outputs.

### `sigmetum-backend`

1. Añadir job `deploy` al `.github/workflows/ci.yml` existente, con `needs: verify`.

2. El job usa `aws-actions/configure-aws-credentials@v4` con `role-to-assume` (OIDC).

3. El zip se construye con `zip -r` excluyendo los directorios innecesarios.

4. Actualizar `docs/integracion/para-infra.md` para documentar las variables de GitHub Actions que hay que configurar.

## 8. Orden de despliegue (primera vez)

1. Aplicar Terraform en infra (dev primero, luego prod) para crear los roles OIDC.
2. Configurar las variables `AWS_ROLE_*` y `S3_BUCKET_*` en GitHub Actions del repo backend.
3. Hacer push a `feature/testing` para verificar el pipeline de dev.
4. Hacer push a `master` para verificar el de prod.

## 9. Restricciones y lo que no entra en scope

- No se toca `terraform apply` desde CI (solo IAM/OIDC, no infra de Beanstalk).
- No se leen ni imprimen `terraform.tfvars` ni credenciales en ningún log.
- `npm test` sigue comentado (deuda M11); no se activa aquí.
- El workflow no hace `--auto-approve` ni ningún comando destructivo de Terraform.
- El provider OIDC de GitHub es único por cuenta AWS; si ya existe, hay que importarlo (`terraform import`) antes de aplicar — esto queda fuera del plan de implementación y se confirma antes del apply.
