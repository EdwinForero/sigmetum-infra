# Referencia de módulos y entornos

Variables de entrada y outputs de cada módulo y entorno de Terraform. Es la **fuente única** de estos nombres en la documentación: Se valida con `node scripts/docs-check.mjs` (ver [mantenimiento.md](guias/mantenimiento.md#4-validación)).

- Solo hay **nombres y descripciones**, nunca valores de `terraform.tfvars`.
- En "Por defecto", `—` significa que la variable es obligatoria (no tiene `default`).
- Las cifras (número de módulos, variables...) están en [estado-y-deuda-tecnica.md](estado-y-deuda-tecnica.md#métricas).

## Módulo networking

Usa el VPC y las subredes por defecto de la cuenta (solo `data` sources; no crea nada).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | Nombre del entorno. El módulo no la usa internamente |

### Outputs

| Output | Descripción |
|---|---|
| `vpc_id` | Id del VPC por defecto |
| `subnet_ids` | Subredes por defecto de cada zona de disponibilidad |

## Módulo beanstalk

Aplicación y entorno de Elastic Beanstalk (Node.js) para el backend. Los roles `aws-elasticbeanstalk-ec2-role` y `aws-elasticbeanstalk-service-role` **no** los crea Terraform (ver [aws-organizations-setup.md](aws-organizations-setup.md#6-crear-los-roles-de-beanstalk-en-cada-cuenta)).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | `dev` o `prod`; forma los nombres `sigmetum-backend-<entorno>` |
| `solution_stack_name` | string | plataforma Amazon Linux 2023 con Node.js 22 | Plataforma de Beanstalk; Terraform ignora sus cambios (`ignore_changes`) |
| `instance_type` | string | `t3.nano` | Tipo de instancia |
| `min_instances` | number | `1` | Mínimo del grupo de autoescalado |
| `max_instances` | number | `3` | Máximo del grupo de autoescalado |
| `vpc_id` | string | — | VPC donde se despliega |
| `subnet_ids` | list(string) | — | Subredes de las instancias y del balanceador |
| `load_balancer_type` | string | `application` | `single` (sin balanceador, dev) o `application` (ALB, prod) |
| `enable_cdn` | bool | `false` | Crea una distribución CloudFront delante de Beanstalk como terminador HTTPS (solo dev; prod usa el ALB directamente) |
| `ssl_certificate_arn` | string | `""` | Certificado ACM para el listener 443; solo se usa con `application` |
| `ssh_key_name` | string | `""` | Par de claves EC2; vacío desactiva SSH |
| `ssh_allowed_cidrs` | list(string) | `[]` | CIDR con acceso SSH; solo aplica si hay `ssh_key_name` |
| `notification_email` | string | — | Correo de las notificaciones SNS del entorno |
| `app_env_vars` | map(string) | `{}` | Variables de entorno del proceso Node.js (sensible). Claves en [app_env_vars](#app_env_vars) |

### Outputs

| Output | Descripción |
|---|---|
| `endpoint_url` | CNAME del entorno de Beanstalk (sin esquema) |
| `environment_name` | Nombre del entorno |
| `application_name` | Nombre de la aplicación |
| `load_balancers` | Balanceadores asociados al entorno |
| `backend_cdn_url` | URL HTTPS de CloudFront del backend (vacío cuando `enable_cdn = false`; usar como `backend_url` en dev) |

## Módulo storage

Bucket S3 privado con versionado y cifrado, distribución CloudFront con OAC para los assets públicos del frontend, y la política IAM que da acceso al rol de las instancias de Beanstalk.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | Forma el nombre de la política `sigmetum-s3-access-<entorno>` |
| `bucket_name` | string | — | Nombre del bucket de datos y recursos |

### Outputs

| Output | Descripción |
|---|---|
| `bucket_name` | Nombre del bucket |
| `bucket_arn` | ARN del bucket |
| `cdn_url` | URL HTTPS de CloudFront para los assets del frontend (usar como `VITE_S3_URL`) |

## Módulo amplify

App de Amplify conectada a GitHub, con su rama y el `build_spec` del frontend. Define las variables `VITE_*` que se incrustan al compilar (ver [Variables de Amplify](#variables-de-amplify)).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | `dev` o `prod`; forma el nombre `<app_name>-<entorno>` y la etapa de la rama |
| `app_name` | string | `sigmetum-frontend` | Prefijo del nombre de la app |
| `repository` | string | — | URL del repositorio de GitHub del frontend |
| `github_access_token` | string | — | Token de GitHub con permiso `repo` (sensible) |
| `branch` | string | `master` | Rama que se despliega |
| `backend_url` | string | — | URL base del backend inyectada como `VITE_BASE_URL` |
| `s3_url` | string | `""` | URL base de CloudFront inyectada como `VITE_S3_URL`; usar `module.storage.cdn_url` |
| `carousel_image_keys` | string | `""` | Claves S3 separadas por comas inyectadas como `VITE_CAROUSEL_IMAGE_KEYS` |

### Outputs

| Output | Descripción |
|---|---|
| `app_id` | Id de la app de Amplify |
| `default_domain` | Dominio por defecto (`*.amplifyapp.com`) |
| `branch_url` | URL de la rama (`https://<rama>.<dominio>`); las `/` del nombre de rama se sustituyen por `-` |

### Variables de Amplify

Variables de entorno que el módulo define en la app y en la rama. Se comparan con el `.env.example` del frontend.

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_BASE_URL` | App y rama | `backend_url` |
| `VITE_API_PREFIX` | App y rama | `/api` (fijo) |
| `VITE_S3_URL` | App y rama | `s3_url` → `module.storage.cdn_url` (URL de CloudFront) |
| `VITE_CAROUSEL_IMAGE_KEYS` | App y rama | `carousel_image_keys` |
| `NODE_ENV` | App | `environment` |

## Módulo dns

Registro CNAME `backend.<zona>` hacia Beanstalk. Solo lo usa `prod`; la zona de Route53 debe existir.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `zone_name` | string | `sigmetum-a.org` | Zona alojada de Route53 |
| `backend_cname_target` | string | — | CNAME de Beanstalk al que apunta el registro |

### Outputs

| Output | Descripción |
|---|---|
| `zone_id` | Id de la zona de Route53 |
| `backend_fqdn` | Nombre completo del registro del backend |

## Módulo backend-ci-iam

Crea el rol IAM que GitHub Actions asume via OIDC para desplegar el backend en Beanstalk, el proveedor OIDC de GitHub (recurso de cuenta) y el bucket S3 de artefactos de deploy. Se instancia en cada entorno de forma independiente (dev y prod son cuentas AWS separadas).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | Entorno de despliegue: dev o prod |
| `github_repo` | string | — | Repositorio GitHub en formato `owner/name` |
| `github_branch` | string | — | Rama que puede asumir el rol CI |
| `aws_region` | string | — | Región AWS donde viven los recursos de Beanstalk |

### Outputs

| Output | Descripción |
|---|---|
| `role_arn` | ARN del rol IAM para GitHub Actions. Configurar como `AWS_ROLE_{ENV}` en GitHub Actions variables |
| `bucket_name` | Nombre del bucket de artefactos. Configurar como `S3_BUCKET_{ENV}` en GitHub Actions variables |

## Entorno dev

`environments/dev`: instancia única sin balanceador, Amplify en la rama `feature/testing`. Estado remoto en el bucket de la cuenta de preprod. Plantilla de valores: `environments/dev/terraform.tfvars.example`.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `notification_email` | string | — | Correo de notificaciones de Beanstalk |
| `bucket_name` | string | — | Nombre del bucket S3 |
| `ssl_certificate_arn` | string | `""` | Declarada pero sin uso en `dev` |
| `github_access_token` | string | — | Token de GitHub (sensible) |
| `github_repository` | string | — | URL del repositorio del frontend |
| `app_env_vars` | map(string) | `{}` | Variables de la aplicación (sensible) |

### Outputs

| Output | Descripción |
|---|---|
| `beanstalk_url` | Endpoint de Beanstalk (CNAME, sin esquema) |
| `backend_cdn_url` | URL HTTPS de CloudFront del backend (solo dev; `enable_cdn = true`) |
| `amplify_url` | URL de la rama de Amplify |
| `s3_bucket` | Nombre del bucket |
| `cdn_url` | URL HTTPS de CloudFront para los assets del frontend |
| `ci_role_arn` | ARN del rol IAM para GitHub Actions CI (de `module.backend_ci_iam`) |
| `ci_bucket_name` | Nombre del bucket de artefactos de deploy (de `module.backend_ci_iam`) |

## Entorno prod

`environments/prod`: ALB con autoescalado y HTTPS, DNS en Route53, Amplify en `master`. Estado remoto en el bucket de la cuenta de prod. Plantilla de valores: `environments/prod/terraform.tfvars.example`.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `notification_email` | string | — | Correo de notificaciones de Beanstalk |
| `bucket_name` | string | — | Nombre del bucket S3 |
| `ssl_certificate_arn` | string | — | Certificado ACM, en la misma región que el proveedor |
| `github_access_token` | string | — | Token de GitHub (sensible) |
| `github_repository` | string | — | URL del repositorio del frontend |
| `app_env_vars` | map(string) | `{}` | Variables de la aplicación (sensible) |

### Outputs

| Output | Descripción |
|---|---|
| `beanstalk_url` | Endpoint de Beanstalk |
| `backend_fqdn` | Dominio del backend en Route53 |
| `amplify_url` | URL de la rama de Amplify |
| `s3_bucket` | Nombre del bucket |
| `ci_role_arn` | ARN del rol IAM para GitHub Actions CI (de `module.backend_ci_iam`) |
| `ci_bucket_name` | Nombre del bucket de artefactos de deploy (de `module.backend_ci_iam`) |

## app_env_vars

Claves del mapa `app_env_vars` de los dos entornos. El backend las valida al arrancar en `config/validateEnv.js` del repositorio `sigmetum-backend`; si falta una obligatoria, no arranca. Son **secretos**: los valores solo viven en `terraform.tfvars` (ignorado por git).

| Clave | Obligatoria en el backend | Notas |
|---|---|---|
| `PORT` | No | Puerto del proceso; el proxy de Beanstalk reenvía el puerto 80 al 8000 |
| `AWS_REGION` | Sí | Región del bucket; la del proveedor de Terraform |
| `AWS_BUCKET_NAME` | Sí | Debe coincidir con `bucket_name` |
| `JWT_SECRET` | Sí | Distinto en cada entorno |
| `JWT_EXPIRATION` | Sí | Duración del token |
| `ADMIN_USERNAME` | Sí | Usuario administrador |
| `ADMIN_PASSWORD` | Sí | Hash bcrypt, nunca el texto en claro |
| `ALLOWED_ORIGIN` | Sí | Origen exacto del frontend del entorno, para CORS (ver [hallazgo C5](estado-y-deuda-tecnica.md#abiertos)) |
| `EMAIL` | Sí | Cuenta de correo del backend |
| `EMAIL_PASSWORD` | Sí | Contraseña de aplicación, no la de la cuenta |
