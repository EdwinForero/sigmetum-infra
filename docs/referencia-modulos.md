# Referencia de módulos y entornos

Variables de entrada y outputs de cada módulo y entorno de Terraform. Es la **fuente única** de estos nombres en la documentación: Se valida con `node scripts/docs-check.mjs` (ver [mantenimiento.md](guias/mantenimiento.md#4-validación)).

- Solo hay **nombres y descripciones**, nunca valores de `terraform.tfvars`.
- En "Por defecto", `—` significa que la variable es obligatoria (no tiene `default`).
- Las cifras (número de módulos, variables...) están en [estado-y-deuda-tecnica.md](estado-y-deuda-tecnica.md#métricas).

## Módulo networking

Usa el VPC y las subredes por defecto de la cuenta (solo `data` sources; no crea nada).

### Variables

Sin variables.

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
| `app_env_vars` | map(string) | `{}` | Variables de entorno del proceso Node.js (sensible), **secretos incluidos**: tabla en [app_env_vars](#app_env_vars). Una `validation` exige en `plan` seis claves: las cinco obligatorias de la tabla más `COGNITO_USER_POOL_ID` (por nombre, no por valor; esta última la inyecta el entorno, ver [Claves inyectadas por Terraform](#claves-inyectadas-por-terraform)), y acepta claves extra. Aviso S6: `EMAIL_PASSWORD` viaja como propiedad de entorno y, con `nonsensitive`, puede verse en la salida de `terraform plan` y en el estado |

### Outputs

| Output | Descripción |
|---|---|
| `endpoint_url` | CNAME del entorno de Beanstalk (sin esquema) |
| `environment_name` | Nombre del entorno |
| `application_name` | Nombre de la aplicación |
| `load_balancers` | Balanceadores del entorno (en un ALB, el ARN; **por confirmar**) |
| `backend_cdn_url` | URL HTTPS de CloudFront del backend (vacío cuando `enable_cdn = false`; usar como `backend_url` en dev) |

### Listener HTTPS y redirección 80 a 443

La condición `local.https_enabled` (`load_balancer_type = "application"` y `ssl_certificate_arn` no vacío) activa el listener 443 y la redirección. Con ella, `data.aws_lb_listener.http` lee el listener del puerto 80 que crea Beanstalk (se usa `load_balancers[0]` como ARN del ALB, **(por confirmar)**) y `aws_lb_listener_rule.http_to_https` le añade una regla de prioridad 1 para `/*` que redirige a `HTTPS` puerto 443 con `HTTP_301`. No se importa el listener (`terraform import` está prohibido) ni se toca el health check, que va del grupo de destino al puerto 80 de la instancia y no pasa por el listener. En `dev` (instancia única) no se crea nada. La regla vive fuera del CloudFormation de Beanstalk: si Beanstalk recrea el listener 80, se pierde (S16 en [estado-y-deuda-tecnica.md](estado-y-deuda-tecnica.md#abiertos)).

### Restricción del origen a CloudFront (solo `dev`)

La condición `local.restrict_origin` (`enable_cdn` y `load_balancer_type = "single"`) crea, solo en `dev`, un grupo de seguridad propio de la instancia y lo pasa a Beanstalk con el setting `SecurityGroups` del espacio de nombres `aws:autoscaling:launchconfiguration`. Sin variables ni outputs nuevos. **(verificado en código; efecto en AWS por confirmar hasta el `apply`, S17)** **Estado (10/11/2026): aplicado en `dev`, pero no cierra el acceso directo: Beanstalk conserva su propio grupo con el puerto 80 abierto (S17 abierto, a arreglar después).**

| Recurso | Qué hace |
|---|---|
| `data.aws_ec2_managed_prefix_list.cloudfront` | Lee la lista de prefijos gestionada de CloudFront (`origin-facing`) |
| `aws_security_group.origin` | Grupo propio de la instancia (`create_before_destroy`) |
| `aws_vpc_security_group_ingress_rule.origin_http_cloudfront` | Entrada TCP por el puerto 80 solo desde esa lista de prefijos |
| `aws_vpc_security_group_ingress_rule.origin_remote_access` | Acceso remoto desde `ssh_allowed_cidrs`, solo si `ssh_key_name` no está vacío (en `dev` está desactivado: no se crea) |
| `aws_vpc_security_group_egress_rule.origin_all` | Salida abierta a todo: el backend sale a S3, a los endpoints de Beanstalk y al SMTP en otros puertos; es la misma apertura que ya tenía el grupo que crea Beanstalk |

`prod` no cambia en este punto: el ALB tiene su propio grupo gestionado por Beanstalk y el recuento de estos recursos es cero (que el ALB no necesite este cambio, por confirmar). Cambiar `SecurityGroups` modifica la plantilla de lanzamiento y la instancia de `dev` se reemplaza: unos minutos de corte (por confirmar). La lista de prefijos cuenta como una regla por entrada y la cuota por defecto del grupo puede quedarse justa: si el `apply` falla con `RulesPerSecurityGroupLimitExceeded`, hay que pedir un aumento en Service Quotas (por confirmar). Si tras el `apply` un `curl` directo al CNAME sigue dando `200`, se revierte (puerta de decisión de S17).

## Módulo storage

Bucket S3 privado con versionado y cifrado, distribución CloudFront con OAC para los assets públicos del frontend, y la política IAM que da acceso al rol de las instancias de Beanstalk.

### Políticas y protección del bucket

- **Política del bucket** (`aws_s3_bucket_policy.app`; un bloque `moved` la renombra desde `cloudfront_oac` sin tocar el recurso en AWS, ver M12): dos sentencias. `AllowCloudFrontOAC` da `s3:GetObject` a CloudFront solo sobre `assets/*` y solo a la distribución del módulo (`AWS:SourceArn`). `DenyInsecureTransport` deniega `s3:*` a `Principal = "*"` sobre el bucket y sus objetos cuando `aws:SecureTransport` es `false`; solo restringe, no concede.
- **Política IAM del rol de instancias** (`aws_iam_role_policy.beanstalk_s3`): `ObjectsInGalleryAndData` (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` sobre `gallery/*` y `data/*`) y `ListGalleryAndData` (`s3:ListBucket` sobre el bucket con `StringLike` en `s3:prefix` para `gallery/*` y `data/*`). Un listado sin `Prefix`, de la raíz o de `assets/` queda denegado, igual que leer o escribir en `assets/`.
- **`prevent_destroy = true`** en `aws_s3_bucket.app`: `terraform destroy` falla mientras esté (ver el procedimiento de vaciado en el [README](../README.md#destruir-un-entorno)).
- **Ciclo de vida** (`aws_s3_bucket_lifecycle_configuration.app`): `expire-noncurrent-versions` expira las versiones no actuales a los 180 días y limpia los marcadores de borrado huérfanos; `abort-incomplete-multipart` aborta las subidas multipart incompletas a los 7 días. Las versiones vigentes no caducan.
- **Bucket de logs de acceso** (`aws_s3_bucket.access_logs`, nombre `sigmetum-access-logs-<entorno>`, uno por entorno, sin variable nueva): recibe los registros de acceso de S3 del bucket de datos (prefijo `app-data/`, `aws_s3_bucket_logging.app`) y del bucket de staging de Beanstalk (prefijo `beanstalk-staging/`, ver [backend-ci-iam](#módulo-backend-ci-iam)). Recursos: el bucket (con `prevent_destroy = true`), `aws_s3_bucket_public_access_block.access_logs`, `aws_s3_bucket_server_side_encryption_configuration.access_logs` (AES256), `aws_s3_bucket_versioning.access_logs`, `aws_s3_bucket_ownership_controls.access_logs` (`BucketOwnerEnforced`, sin ACL), `aws_s3_bucket_lifecycle_configuration.access_logs` y `aws_s3_bucket_policy.access_logs`.
- **Política del bucket de logs** (`aws_s3_bucket_policy.access_logs`): `S3ServerAccessLogsDelivery` da `s3:PutObject` a `logging.s3.amazonaws.com` solo sobre `app-data/*` y `beanstalk-staging/*`, con las condiciones `aws:SourceArn` (el bucket de datos y el de staging) y `aws:SourceAccount` (la cuenta, por data source); `DenyInsecureTransport` deniega `s3:*` sin TLS. Depende del bloqueo público, la propiedad de objetos, el cifrado y el versionado para no escribir en paralelo sobre el bucket.
- **Ciclo de vida del bucket de logs**: `expire-logs` expira los objetos a los 90 días y las versiones no actuales a los 7; `expire-orphan-delete-markers` limpia los marcadores de borrado huérfanos; `abort-incomplete-multipart` aborta las subidas incompletas a los 7 días. Los logs contienen IP de visitantes y claves de objeto.
- El bucket de logs no registra sus propios accesos (evita el bucle de logs sobre logs): excepción aceptada M15 en `KNOWN_DEBT` de `quality-check`.

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
| `access_logs_bucket_name` | Nombre del bucket de logs de acceso; sale de la política de entrega, así que los consumidores (el logging de `backend-ci-iam`) se crean después de ella |
| `cdn_url` | URL HTTPS de CloudFront para los assets del frontend (usar como `VITE_S3_URL`) |

## Módulo amplify

App de Amplify conectada a GitHub, con su rama y el `build_spec` del frontend (`preBuild`: `nvm install 22 && nvm use 22`, `npm ci` y `npm test`; `build`: `npm run build`; artefacto `dist`). Si `npm test` falla, Amplify no despliega. Define las variables `VITE_*` que se incrustan al compilar (ver [Variables de Amplify](#variables-de-amplify)).

Además, la app lleva `custom_headers` (caché y seguridad, en `dev` y `prod`) y, **solo si `custom_domains` no está vacío** (hoy solo `prod`), la asociación de dominio y sus registros de Route53:

- **Cabeceras** (`custom_headers` de `aws_amplify_app.this`): `Strict-Transport-Security: max-age=86400` (un día, sin `includeSubDomains` ni `preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (sin cámara, micrófono, geolocalización, pago ni USB) y `Content-Security-Policy-Report-Only` (solo informa, no bloquea). `Cache-Control: no-cache` en `/index.html` y `public, max-age=31536000, immutable` en `/assets/*`; ese patrón es el `dist/assets/` de Vite, no los ficheros del bucket (otro origen, CloudFront). La CSP se calcula en `locals` con `s3_url`, `backend_url` y la región del proveedor (`data.aws_region.current`): sin orígenes hardcodeados, así que `dev` y `prod` salen distintas. Efecto en AWS **(por confirmar)** hasta el `apply` y un build nuevo.
- **Dominio**: `aws_amplify_domain_association.this` (uno por clave de `custom_domains`, con `wait_for_verification = false`, de modo que el `apply` no espera a la validación del certificado; Amplify gestiona el certificado por validación DNS).
- **Registros de Route53** (`modules/dns` no cambia): el módulo consulta con `data.aws_route53_zone.custom` la zona pública que se llama igual que el dominio raíz y que debe estar en la cuenta donde se aplica. Crea `aws_route53_record.certificate_validation` (CNAME de validación del certificado), `aws_route53_record.apex` (alias de tipo A hacia la distribución de CloudFront que indica Amplify, porque un CNAME no se permite en el apex) y `aws_route53_record.subdomain` (CNAME para `www`, TTL 300). Sin AAAA y sin `allow_overwrite`: si ya existe un registro de apex o `www`, el `apply` falla con "already exists" y no pisa nada. Los destinos salen de `certificate_verification_dns_record` y `dns_record` de la asociación; si Amplify los devuelve vacíos en el primer `apply`, se repite el `apply` (la asociación ya está en el estado). Formato real de esos campos y alias del apex **(por confirmar)** hasta el `apply`.
- `branch_url` sigue siendo la URL del dominio por defecto, que sigue activa. `site_origins` es la lista de orígenes del frontend (los dominios propios si los hay; si no, `branch_url`); ambos comparten una expresión (`local.branch_url`) y `site_origins` alimenta `allowed_origins` de `modules/cognito`.

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
| `cognito_domain_url` | string | `""` | URL base del Hosted UI de Cognito: se inyecta como `VITE_COGNITO_DOMAIN` (solo rama) y se añade al `connect-src` de la CSP junto con el endpoint de la API de Cognito (`https://cognito-idp.<región>.amazonaws.com`); vacío omite los dos |
| `cognito_client_id` | string | `""` | Id del cliente de Cognito, inyectado como `VITE_COGNITO_CLIENT_ID` (solo rama) |
| `cognito_user_pool_id` | string | `""` | Id del pool de Cognito (el prefijo es la región), inyectado como `VITE_COGNITO_USER_POOL_ID` (solo rama) para el formulario de login del frontend; no es un secreto |
| `custom_domains` | map(list(string)) | `{}` | Dominio raíz => prefijos de subdominio (`""` es el apex, `"www"` es `www.<raíz>`). Vacío no crea asociación ni registros. La clave debe ser un nombre en minúsculas, sin esquema, ruta ni puerto (`validation`) |

### Outputs

| Output | Descripción |
|---|---|
| `app_id` | Id de la app de Amplify |
| `default_domain` | Dominio por defecto (`*.amplifyapp.com`) |
| `branch_url` | URL de la rama (`https://<rama>.<dominio>`); las `/` del nombre de rama se sustituyen por `-` |
| `site_origins` | Orígenes (`https://host`, sin barra final) desde los que se sirve el frontend: los dominios propios si `custom_domains` no está vacío; si no, `branch_url` |

### Variables de Amplify

Variables de entorno que el módulo define en la app y en la rama. Se comparan con el `.env.example` del frontend.

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_BASE_URL` | App y rama | `backend_url` |
| `VITE_API_PREFIX` | App y rama | `/api/v1` (fijo) |
| `VITE_S3_URL` | App y rama | `s3_url` → `module.storage.cdn_url` (URL de CloudFront) |
| `VITE_CAROUSEL_IMAGE_KEYS` | App y rama | `carousel_image_keys` |
| `VITE_COGNITO_DOMAIN` | Solo rama | `cognito_domain_url` → `module.cognito.domain_url`. Solo en la rama por el ciclo de `dev` (`beanstalk` → `cognito` → `amplify` → `beanstalk`): la app depende del dominio de Cognito solo para la CSP; con una rama por app equivale, porque la variable de rama prevalece (**por confirmar**) |
| `VITE_COGNITO_CLIENT_ID` | Solo rama | `cognito_client_id` → `module.cognito.client_id`. Mismo motivo |
| `VITE_COGNITO_USER_POOL_ID` | Solo rama | `cognito_user_pool_id` → `module.cognito.user_pool_id` (la región es su prefijo). Solo en la rama, igual que el id del cliente. Lo usa el formulario de login propio del frontend (SRP); no es un secreto |

Amplify ya no define `NODE_ENV` (M2). Vite fija `production` en `vite build` y Vitest fija `test`. Fijar `production` en toda la app haría que `npm ci` omitiera las `devDependencies` (se perderían `vite` y `vitest`) y que Vitest usara el React de producción, donde `act` no funciona. Con `NODE_ENV=dev`, React elegía su build de desarrollo aunque Vite imprimiera «building for production».

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

## Módulo cognito

Pool de usuarios de Amazon Cognito, dominio del Hosted UI y cliente público para el login del administrador. Los atributos del proveedor `aws ~> 5.0` y la disponibilidad de Cognito en `eu-west-3` están **(por confirmar)**: `terraform validate` solo comprueba que los nombres existan. Contrato con el backend y el frontend en [para-backend.md](integracion/para-backend.md#login-con-cognito-contrato-del-backend) y [para-frontend.md](integracion/para-frontend.md#login-con-cognito-formulario-propio).

- **Pool** (`aws_cognito_user_pool.this`, nombre `<app_name>-<entorno>`): MFA `ON` con TOTP, `username_attributes = ["email"]` (**inmutable**: cambiarlo reemplaza el pool y borra usuarios y TOTP), registro cerrado (`allow_admin_create_user_only`), contraseña de 14 caracteres con las cuatro clases (temporal válida 3 días), recuperación `admin_only`, `deletion_protection` `ACTIVE` **solo en `prod`** (`dev` sin protección: aceptado), etiqueta `Component = "identity"`.
- **Dominio** (`aws_cognito_user_pool_domain.this`): prefijo `domain_prefix` (único por región; si está ocupado el `apply` falla).
- **Cliente** (`aws_cognito_user_pool_client.this`, nombre `<app_name>-<entorno>-web`, **por confirmar**): sin secreto; autenticación explícita `ALLOW_USER_SRP_AUTH` (login con formulario propio del frontend, sin enviar la contraseña en claro; decisión del usuario del 10/11/2026) y `ALLOW_REFRESH_TOKEN_AUTH`; **ningún flujo de contraseña por API** (`ALLOW_USER_PASSWORD_AUTH` y `ALLOW_ADMIN_USER_PASSWORD_AUTH` están prohibidos por `quality-check`). Se mantienen el flujo OAuth `code`, los ámbitos `openid` y `email`, el proveedor `COGNITO` y las direcciones de retorno, para que el **Hosted UI siga funcionando como respaldo** (retirarlo es una decisión pendiente). Tokens de acceso e id de 60 minutos y refresco de 8 horas, revocación activa. **PKCE (Hosted UI) y SRP (formulario) son requisitos del frontend**, no controles de este módulo.
- **Direcciones de retorno:** cada `allowed_origins` más `callback_path` y `logout_path`; el entorno pasa `module.amplify.site_origins`. Sin `localhost`.
- **`C16`:** el backend no valida `client_id` ni grupos; cualquier usuario del pool es administrador (válido solo con el registro cerrado).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | `dev` o `prod`; forma el nombre del pool y activa `deletion_protection` solo en `prod` |
| `app_name` | string | `sigmetum` | Prefijo del nombre del pool: `<app_name>-<entorno>` |
| `domain_prefix` | string | — | Prefijo del dominio del Hosted UI (`<prefijo>.auth.<región>.amazoncognito.com`); minúsculas, números y guiones, sin `aws`, `amazon` ni `cognito`. Único por región |
| `allowed_origins` | list(string) | — | Orígenes del frontend (`https://host`, sin barra final) con permiso de retorno; sin `validation` porque en `dev` se desconocen hasta el `apply` |
| `callback_path` | string | `/auth/callback` | Ruta de retorno del inicio de sesión (debe empezar por `/`) |
| `logout_path` | string | `/` | Ruta de retorno del cierre de sesión (debe empezar por `/`) |

### Outputs

| Output | Descripción |
|---|---|
| `user_pool_id` | Id del pool; la región es su prefijo. Es lo único que recibe el backend (`COGNITO_USER_POOL_ID`) |
| `client_id` | Id del cliente público (sin secreto) |
| `domain_url` | URL base del Hosted UI (`https`, sin barra final) |
| `region` | Región del pool |
| `callback_urls` | URL de retorno del inicio de sesión registradas en el cliente |
| `logout_urls` | URL de cierre de sesión registradas en el cliente |

## Módulo backend-ci-iam

Crea el rol IAM que GitHub Actions asume via OIDC para desplegar el backend en Beanstalk, el proveedor OIDC de GitHub (recurso de cuenta) y el bucket S3 de artefactos de deploy. Se instancia en cada entorno de forma independiente (dev y prod son cuentas AWS separadas).

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `environment` | string | — | Entorno de despliegue: dev o prod |
| `github_repo` | string | — | Repositorio GitHub en formato `owner/name` |
| `github_branch` | string | — | Rama que puede asumir el rol CI |
| `aws_region` | string | — | Región AWS donde viven los recursos de Beanstalk |
| `access_logs_bucket_name` | string | — | Nombre del bucket que recibe los registros de acceso del bucket de staging de Beanstalk; obligatoria, los entornos le pasan `module.storage.access_logs_bucket_name` |

**Registros de acceso del bucket de staging** (`aws_s3_bucket_logging.eb_staging`): activa los registros del bucket `elasticbeanstalk-<región>-<cuenta>` (nombre derivado de la región y la cuenta, sin literales) hacia `access_logs_bucket_name` con el prefijo `beanstalk-staging/`. El bucket lo crea Beanstalk, no Terraform: solo se gestiona este ajuste, sin `import`. Se sobrescribe cualquier configuración de logs previa y un cambio manual posterior aparecerá como deriva; en una cuenta sin el bucket (antes del primer despliegue de Beanstalk) el `apply` falla con `NoSuchBucket`. Los permisos del rol de CI no cambian.

### Outputs

| Output | Descripción |
|---|---|
| `role_arn` | ARN del rol IAM para GitHub Actions. Configurar como `AWS_ROLE_{ENV}` en GitHub Actions variables |

## Entorno dev

`environments/dev`: instancia única sin balanceador, Amplify en la rama `feature/testing`. Estado remoto en el bucket de la cuenta de preprod. Cognito con el prefijo de dominio `sigmetum-a-dev` y `deletion_protection` inactiva. Plantilla de valores: `environments/dev/terraform.tfvars.example`.

### Variables

| Variable | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `notification_email` | string | — | Correo de notificaciones de Beanstalk |
| `bucket_name` | string | — | Nombre del bucket S3 |
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
| `cognito_user_pool_id` | Id del pool de Cognito (no es un secreto) |
| `cognito_client_id` | Id del cliente de Cognito (no es un secreto) |
| `cognito_domain_url` | URL base del Hosted UI de Cognito |
| `cognito_region` | Región del pool de Cognito |
| `cognito_callback_urls` | URL de retorno del inicio de sesión registradas en el cliente |
| `cognito_logout_urls` | URL de cierre de sesión registradas en el cliente |

## Entorno prod

`environments/prod`: ALB con autoescalado y HTTPS, DNS en Route53, Amplify en `master` (con `s3_url = module.storage.cdn_url`) y `custom_domains` fijo en `main.tf` (no es una variable del entorno): el dominio raíz de la zona con el apex y `www`; `dev` no lo define y por eso no crea dominio ni registros. Estado remoto en el bucket de la cuenta de prod. Cognito con el prefijo de dominio `sigmetum-a-prod` y `deletion_protection` activa (las dos únicas divergencias de Cognito entre entornos). Plantilla de valores: `environments/prod/terraform.tfvars.example`.

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
| `cognito_user_pool_id` | Id del pool de Cognito (no es un secreto) |
| `cognito_client_id` | Id del cliente de Cognito (no es un secreto) |
| `cognito_domain_url` | URL base del Hosted UI de Cognito |
| `cognito_region` | Región del pool de Cognito |
| `cognito_callback_urls` | URL de retorno del inicio de sesión registradas en el cliente |
| `cognito_logout_urls` | URL de cierre de sesión registradas en el cliente |

## app_env_vars

Claves del mapa `app_env_vars` de los dos entornos (las que pone el humano en `terraform.tfvars`, ignorado por git). El backend las valida al arrancar en `config/validateEnv.js` del repositorio `sigmetum-backend`; si falta una obligatoria, no arranca. **En dev, el único secreto de `app_env_vars` es `EMAIL_PASSWORD`** (corte único a Cognito, `S18` en dev; [spec](specs/2026-10-31-cognito-corte-unico-design.md)): **aviso S6**, viaja como propiedad de entorno de Beanstalk, `for_each = nonsensitive(var.app_env_vars)` quita la marca de sensible y puede verse en la salida de `terraform plan` y en el estado (no pegues esa salida). La variable de `modules/beanstalk` lleva una `validation` que comprueba en `plan` seis claves: las cinco obligatorias de la tabla más `COGNITO_USER_POOL_ID` (solo los nombres, nunca los valores); `PORT` y `TRUST_PROXY_HOPS` son opcionales en el backend, las claves extra son válidas y un valor vacío no se rechaza. **Prod:** las cuatro claves del login antiguo (`JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) ya no están en las plantillas ni en la tabla, pero un `terraform.tfvars` de prod que aún las tenga sigue siendo válido, porque la `validation` acepta claves extra; prod las conserva hasta su corte propio (`S18-prod`, tras verificar el TOTP con los dos administradores). No se listan en la tabla porque obligarían a las plantillas a definirlas. Hasta que el backend deje de exigirlas, `quality-check` y `docs-check` darán avisos de coherencia (no fallos).

| Clave | Obligatoria en el backend | Notas |
|---|---|---|
| `PORT` | No | Puerto del proceso; el proxy de Beanstalk reenvía el puerto 80 al 8000 |
| `AWS_REGION` | Sí | Región del bucket; la del proveedor de Terraform |
| `AWS_BUCKET_NAME` | Sí | Debe coincidir con `bucket_name` |
| `ALLOWED_ORIGIN` | Sí | Origen exacto del frontend del entorno, para CORS (ver [hallazgo C5](estado-y-deuda-tecnica.md#resueltos)). Admite una lista separada por comas; en `prod`, `https://<dominio>,https://www.<dominio>` (ver [para-backend.md](integracion/para-backend.md#7-allowed_origin-por-entorno)). Debe coincidir con los orígenes de `cognito_callback_urls` |
| `EMAIL` | Sí | Cuenta de correo del backend |
| `EMAIL_PASSWORD` | Sí | **Secreto (S6).** Contraseña de aplicación, no la de la cuenta |
| `TRUST_PROXY_HOPS` | No | Saltos de proxy de confianza del backend: cadena entera de 1 a 5, sin espacios ni ceros a la izquierda (el 0 solo con `NODE_ENV` `local` o `test`); 1 si no se define. `dev` y `prod` llevan el mismo valor; el de `dev` está medido en nginx y deducido en Express, y el de `prod` está por confirmar (ver [para-backend.md](integracion/para-backend.md#6-plataforma-tamaño-de-instancia-y-correo-saliente)) |

## Claves inyectadas por Terraform

Claves que Terraform añade a `app_env_vars` en `main.tf` de cada entorno (`merge`), a partir de otros módulos. **No** van en `terraform.tfvars` ni en las plantillas `.example`. **(verificado en código; efecto en AWS por confirmar hasta el `apply`)**

| Clave | Obligatoria en el backend | Notas |
|---|---|---|
| `COGNITO_USER_POOL_ID` | Sí | Id del pool de Cognito (`module.cognito.user_pool_id`); la región va en su prefijo. El backend la exige en `validateEnv.js` (forma `<región>_<id>` y región igual a `AWS_REGION`; si no, no arranca) **(verificado en `sigmetum-backend`, commit `578c59c`)**. No es un secreto |
