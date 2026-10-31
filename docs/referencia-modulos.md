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

### Listener HTTPS y redirección 80 a 443

La condición `local.https_enabled` (`load_balancer_type = "application"` y `ssl_certificate_arn` no vacío) activa el listener 443 y la redirección. Con ella, `data.aws_lb_listener.http` lee el listener del puerto 80 que crea Beanstalk (se usa `load_balancers[0]` como ARN del ALB, **(por confirmar)**) y `aws_lb_listener_rule.http_to_https` le añade una regla de prioridad 1 para `/*` que redirige a `HTTPS` puerto 443 con `HTTP_301`. No se importa el listener (`terraform import` está prohibido) ni se toca el health check, que va del grupo de destino al puerto 80 de la instancia y no pasa por el listener. En `dev` (instancia única) no se crea nada. La regla vive fuera del CloudFormation de Beanstalk: si Beanstalk recrea el listener 80, se pierde (S16 en [estado-y-deuda-tecnica.md](estado-y-deuda-tecnica.md#abiertos)).

## Módulo storage

Bucket S3 privado con versionado y cifrado, distribución CloudFront con OAC para los assets públicos del frontend, y la política IAM que da acceso al rol de las instancias de Beanstalk.

### Políticas y protección del bucket

- **Política del bucket** (`aws_s3_bucket_policy.cloudfront_oac`; el nombre se conserva por compatibilidad con el estado, ver M12): dos sentencias. `AllowCloudFrontOAC` da `s3:GetObject` a CloudFront solo sobre `assets/*` y solo a la distribución del módulo (`AWS:SourceArn`). `DenyInsecureTransport` deniega `s3:*` a `Principal = "*"` sobre el bucket y sus objetos cuando `aws:SecureTransport` es `false`; solo restringe, no concede.
- **Política IAM del rol de instancias** (`aws_iam_role_policy.beanstalk_s3`): `ObjectsInGalleryAndData` (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` sobre `gallery/*` y `data/*`) y `ListGalleryAndData` (`s3:ListBucket` sobre el bucket con `StringLike` en `s3:prefix` para `gallery/*` y `data/*`). Un listado sin `Prefix`, de la raíz o de `assets/` queda denegado, igual que leer o escribir en `assets/`.
- **`prevent_destroy = true`** en `aws_s3_bucket.app`: `terraform destroy` falla mientras esté (ver el procedimiento de vaciado en el [README](../README.md#destroy-an-environment)).
- **Ciclo de vida** (`aws_s3_bucket_lifecycle_configuration.app`): `expire-noncurrent-versions` expira las versiones no actuales a los 180 días y limpia los marcadores de borrado huérfanos; `abort-incomplete-multipart` aborta las subidas multipart incompletas a los 7 días. Las versiones vigentes no caducan.

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

App de Amplify conectada a GitHub, con su rama y el `build_spec` del frontend (`preBuild`: `nvm install 22 && nvm use 22`, `npm ci` y `npm test`; `build`: `npm run build`; artefacto `dist`). Si `npm test` falla, Amplify no despliega. Define las variables `VITE_*` que se incrustan al compilar (ver [Variables de Amplify](#variables-de-amplify)).

Además, la app lleva `custom_headers` (caché y seguridad, en `dev` y `prod`) y, **solo si `custom_domains` no está vacío** (hoy solo `prod`), la asociación de dominio y sus registros de Route53:

- **Cabeceras** (`custom_headers` de `aws_amplify_app.this`): `Strict-Transport-Security: max-age=86400` (un día, sin `includeSubDomains` ni `preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (sin cámara, micrófono, geolocalización, pago ni USB) y `Content-Security-Policy-Report-Only` (solo informa, no bloquea). `Cache-Control: no-cache` en `/index.html` y `public, max-age=31536000, immutable` en `/assets/*`; ese patrón es el `dist/assets/` de Vite, no los ficheros del bucket (otro origen, CloudFront). La CSP se calcula en `locals` con `s3_url`, `backend_url` y la región del proveedor (`data.aws_region.current`): sin orígenes hardcodeados, así que `dev` y `prod` salen distintas. Efecto en AWS **(por confirmar)** hasta el `apply` y un build nuevo.
- **Dominio**: `aws_amplify_domain_association.this` (uno por clave de `custom_domains`, con `wait_for_verification = false`, de modo que el `apply` no espera a la validación del certificado; Amplify gestiona el certificado por validación DNS).
- **Registros de Route53** (`modules/dns` no cambia): el módulo consulta con `data.aws_route53_zone.custom` la zona pública que se llama igual que el dominio raíz y que debe estar en la cuenta donde se aplica. Crea `aws_route53_record.certificate_validation` (CNAME de validación del certificado), `aws_route53_record.apex` (alias de tipo A hacia la distribución de CloudFront que indica Amplify, porque un CNAME no se permite en el apex) y `aws_route53_record.subdomain` (CNAME para `www`, TTL 300). Sin AAAA y sin `allow_overwrite`: si ya existe un registro de apex o `www`, el `apply` falla con "already exists" y no pisa nada. Los destinos salen de `certificate_verification_dns_record` y `dns_record` de la asociación; si Amplify los devuelve vacíos en el primer `apply`, se repite el `apply` (la asociación ya está en el estado). Formato real de esos campos y alias del apex **(por confirmar)** hasta el `apply`.
- Sin outputs nuevos; `branch_url` sigue siendo la URL del dominio por defecto, que sigue activa.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | `dev` o `prod`; forma el nombre `<app_name>-<entorno>` y la etapa de la rama |
| `app_name` | string | `sigmetum-frontend` | Prefijo del nombre de la app |
| `repository` | string | — | URL del repositorio de GitHub del frontend |
| `github_access_token` | string | — | Token de GitHub con permiso `repo` (sensible) |
| `branch` | string | `master` | Rama que se despliega |
| `backend_url` | string | — | URL base del backend inyectada como `VITE_BASE_URL` |
| `s3_url` | string | `""` | URL base de CloudFront inyectada como `VITE_S3_URL`; usar `module.storage.cdn_url` (`dev` y `prod`) |
| `carousel_image_keys` | string | `""` | Claves S3 separadas por comas inyectadas como `VITE_CAROUSEL_IMAGE_KEYS` |
| `custom_domains` | map(list(string)) | `{}` | Dominio raíz => prefijos de subdominio (`""` es el apex, `"www"` es `www.<raíz>`). Vacío no crea asociación ni registros. La clave debe ser un nombre en minúsculas, sin esquema, ruta ni puerto (`validation`) |

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
| `VITE_API_PREFIX` | App y rama | `/api/v1` (fijo) |
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

## Entorno prod

`environments/prod`: ALB con autoescalado y HTTPS, DNS en Route53, Amplify en `master` (con `s3_url = module.storage.cdn_url`) y `custom_domains` fijo en `main.tf` (no es una variable del entorno): el dominio raíz de la zona con el apex y `www`; `dev` no lo define y por eso no crea dominio ni registros. Estado remoto en el bucket de la cuenta de prod. Plantilla de valores: `environments/prod/terraform.tfvars.example`.

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
| `ALLOWED_ORIGIN` | Sí | Origen exacto del frontend del entorno, para CORS (ver [hallazgo C5](estado-y-deuda-tecnica.md#resueltos)). Admite una lista separada por comas; en `prod`, `https://<dominio>,https://www.<dominio>` (ver [para-backend.md](integracion/para-backend.md#7-allowed_origin-por-entorno)) |
| `EMAIL` | Sí | Cuenta de correo del backend |
| `EMAIL_PASSWORD` | Sí | Contraseña de aplicación, no la de la cuenta |
