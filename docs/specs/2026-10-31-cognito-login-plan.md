# Login de administrador con Amazon Cognito (infraestructura): plan v2

Fecha: 2026-10-31 · Estado: cerrado (v2) · Spec: [design](2026-10-31-cognito-login-design.md)

Plan v2 de 8 pasos de código en 2 fases (5 y 3). **Crítico: sí.** Se mantiene lo que ya estaba bien de la v1 (módulo `cognito`, rotura del ciclo de `dev`, `deletion_protection` condicional, etiqueta `identity`, reversión de Parameter Store) y se incorporan las decisiones del usuario y los puntos de la segunda opinión. Los atributos del proveedor `aws ~> 5.0` (lock 5.100.0) y la disponibilidad de Cognito en `eu-west-3` están **por confirmar**; `terraform validate` solo cubre que los nombres de atributo existan. Los roles no ejecutan `plan` ni `apply`.

## Decisiones de diseño (el developer no decide nada de esto)

1. **Circularidad real en `dev`, y cómo se rompe.**
   - Ciclo: `beanstalk -> cognito (client_id) -> amplify (default_domain) -> beanstalk (backend_cdn_url)`. No hay ciclo con `ALLOWED_ORIGIN` (va por `tfvars`); sí un orden humano ya documentado: en `dev`, `ALLOWED_ORIGIN` se rellena tras el primer `apply`.
   - Tres reglas: el backend recibe solo `COGNITO_USER_POOL_ID` (la región va en el id y `AWS_REGION` ya existe); `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` van **solo en `aws_amplify_branch`** (con una rama por app equivale, porque la variable de rama prevalece sobre la de app, **por confirmar**); la app de Amplify depende del dominio de Cognito solo para la CSP, y ese dominio depende solo del pool.
   - Descartado: pasar `COGNITO_CLIENT_ID` al backend (crea el ciclo); callbacks a mano en `tfvars`; `apply` en dos fases con `-target`.
2. **C16 aceptado por el usuario.** El backend valida firma por JWKS, `iss`, `token_use`, `exp` y RS256; **no valida `client_id` ni grupos**, así que **cualquier usuario del pool es administrador**. Válido solo con el registro cerrado (`allow_admin_create_user_only = true`) y un pool con solo administradores. Vía de salida: validar `client_id` y/o un grupo `admin` en el backend (exige `COGNITO_CLIENT_ID` o grupos y, en `dev`, separar el cliente en otro `apply`); es un cambio de spec.
3. **Direcciones de retorno.** Cero `localhost`, tampoco en `dev`. Cableado único: `allowed_origins = module.amplify.site_origins`. `site_origins` y `branch_url` comparten una sola expresión (`local.branch_url` en `modules/amplify/main.tf`). Rutas fijas `callback_path = "/auth/callback"` y `logout_path = "/"` (confirmadas por el usuario; las crea el frontend). Sin `VITE_*` para las URLs: el frontend usa `window.location.origin` más esas rutas.
4. **Cliente.** `generate_secret = false`; `explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]` (sin `ALLOW_USER_SRP_AUTH`, decisión del usuario). Si el `apply` humano rechazara un cliente solo con refresco y OAuth `code`, es una pregunta a la puerta: no se añade SRP en silencio **(por confirmar)**.
5. **PKCE es un requisito del frontend, no un control de infraestructura** (Terraform no lo impone ni lo verifica). Va a `para-frontend.md`: el frontend envía `code_challenge` S256 y `code_verifier`. En `SEG-13` se separan los controles de infraestructura verificables (MFA TOTP `ON`, registro cerrado, `generate_secret = false`, `deletion_protection` en `prod`, cero `localhost`) y PKCE como requisito del frontend «no comprobable desde infra».
6. **Contrato del backend** (hoy `middleware/tokenAuthentication.js:11` solo acepta HS256 con `JWT_SECRET`, sin librería JWKS): `iss` exacto `https://cognito-idp.<región>.amazonaws.com/<COGNITO_USER_POOL_ID>`; `token_use = access`; `exp` vigente; **RS256 fijo en `algorithms`, nunca el `alg` del cabecero**; caché de JWKS con rotación y límite de peticiones. Convivencia en la transición: se prueba primero el verificador antiguo (`HS256`) y, si falla, el de Cognito (`RS256`); no se enruta por el `alg` del cabecero.
7. **`username_attributes = ["email"]`: decisión CERRADA.** Inmutable: cambiarlo reemplaza el pool, borra usuarios y TOTP, y en `prod` `deletion_protection` impide arreglarlo con `apply` sin un cambio revisado. Descartado `alias_attributes` o nombre libre (obliga a un segundo identificador heredero de `ADMIN_USERNAME`; nada aporta con registro cerrado). Consecuencia: el administrador entra con un correo real, y los correos deben ser buzones de personas distintas.
8. **Parámetros confirmados.** Contraseña de 14 caracteres mínimo, las 4 clases, temporal válida 3 días; tokens de acceso e id 60 minutos y refresco 8 horas; recuperación `admin_only`; prefijos de dominio `sigmetum-a-dev` y `sigmetum-a-prod` (únicos por región; si están ocupados, el `apply` falla).
9. **Segundo administrador de emergencia** (decisión del usuario). Procedimiento humano, sin código ni variable nueva: otro usuario del pool con otro correo, en manos de otra persona, con su propio TOTP. Con `admin_only` y un solo administrador, perder el TOTP bloquea el acceso y `deletion_protection` complica rehacer el pool en `prod`. Por C16, ese segundo usuario también es administrador completo.
10. **Condición del orden de despliegue.** El paso 4 (retirar el login antiguo: backend y después infra) **NO se hace hasta verificar en `prod` que el TOTP funciona** (inicio de sesión por Hosted UI con MFA y comprobación del segundo administrador). Va al procedimiento, al aviso de PR y a `S18`.
11. **Protección contra borrado.** `deletion_protection = ACTIVE` solo si `environment == "prod"` (`prevent_destroy` no admite condición). **`dev` queda sin protección: aceptado por el usuario.** Se actualiza BP-8; el README («Destruir un entorno») explica cómo se levanta, con un cambio revisado.
12. **Etiqueta nueva** `Component = "identity"`: `billing-tags.md` y `TAGGABLE` de `quality-check` (solo `aws_cognito_user_pool`; cliente y dominio no admiten tags en 5.x, **por confirmar**).
13. **S6 reabierto: aviso claro, sin suposiciones.** Al revertir `0885804`, `JWT_SECRET`, `EMAIL_PASSWORD` y el hash `ADMIN_PASSWORD` **vuelven a viajar como propiedades de entorno de Beanstalk**. `for_each = nonsensitive(var.app_env_vars)` (`modules/beanstalk/main.tf:338`) quita la marca de sensible: **pueden verse en la salida de `terraform plan` y en el estado**. No se asume que el proveedor oculte `setting.value`. Este texto va, con estas palabras, al plan, al aviso de PR, a `seguridad.md` (SEG-2) y a `estado` (S6). Mitigaciones existentes: estado cifrado (`aa4b508`) y la regla de no pegar la salida del `plan`.

## Fase 1 (Terraform)

1. **Módulo `modules/cognito`**
   - Archivos: crear `modules/cognito/main.tf`, `variables.tf` y `outputs.tf`.
   - Estructura:
     - `data.aws_region.current`.
     - `aws_cognito_user_pool.this`: `name = "${var.app_name}-${var.environment}"`, `mfa_configuration = "ON"`, `username_attributes = ["email"]`, `auto_verified_attributes = ["email"]`, `username_configuration { case_sensitive = false }`, `admin_create_user_config { allow_admin_create_user_only = true }`, `software_token_mfa_configuration { enabled = true }`, `password_policy` (14 caracteres, las 4 clases, `temporary_password_validity_days = 3`), `account_recovery_setting` con `admin_only`, `deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"`, `tags = { Component = "identity" }`. No usar `user_pool_tier`, `managed_login_version` ni `advanced_security`.
     - `aws_cognito_user_pool_domain.this` con `domain = var.domain_prefix`.
     - `aws_cognito_user_pool_client.this`: `generate_secret = false`, `explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]`, `allowed_oauth_flows = ["code"]`, `allowed_oauth_flows_user_pool_client = true`, `allowed_oauth_scopes = ["openid", "email"]`, `supported_identity_providers = ["COGNITO"]`, `callback_urls` y `logout_urls` desde `locals` (`for origin in var.allowed_origins`, más `callback_path` y `logout_path`), `prevent_user_existence_errors = "ENABLED"`, `enable_token_revocation = true`, `access_token_validity = 60`, `id_token_validity = 60`, `refresh_token_validity = 8` y `token_validity_units` en `minutes`, `minutes` y `hours`.
   - Variables (todas con `type` y `description`): `environment` (obligatoria); `app_name` (default `"sigmetum"`); `domain_prefix` (obligatoria, `validation`: minúsculas, números y guiones, sin `aws`, `amazon` ni `cognito`); `allowed_origins` (`list(string)`, obligatoria, **sin** `validation`: en `dev` es desconocida hasta el `apply`); `callback_path` (`"/auth/callback"`) y `logout_path` (`"/"`), con `validation` de que empiezan por `/`.
   - Outputs (con `description`): `user_pool_id` (solo `aws_cognito_user_pool.this.id`), `client_id`, `domain_url = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"`, `region`, `callback_urls`, `logout_urls`.
   - Sin `provisioner`, comodines, secretos ni ARN. Evitar `key`, `secret`, `token` y `password` en nombres propios de variables y outputs (`quality-check` los marca); los atributos del proveedor como `access_token_validity` no son nombres propios.
   - Comprobación: `terraform fmt -check -recursive` y `terraform validate` tras el paso 3.
   - Norma: BP-1, BP-2, BP-3, BP-6, BP-8, BP-10 y SEG-1.

2. **`modules/amplify`**
   - Archivos: modificar `modules/amplify/main.tf`, `variables.tf` y `outputs.tf`.
   - Cambios:
     - Variables nuevas `cognito_domain_url` y `cognito_client_id`: `string`, default `""`.
     - `locals`: añadir `branch_url = "https://${replace(var.branch, "/", "-")}.${aws_amplify_app.this.default_domain}"`; el comentario «Amplify replaces "/" with "-"...» se mueve junto a este local. `output "branch_url"` pasa a `value = local.branch_url` (mismo valor).
     - `output "site_origins"`: `length(var.custom_domains) > 0 ? [for fqdn in sort(keys(local.domain_records)) : "https://${fqdn}"] : [local.branch_url]` (`list(string)` en ambas ramas).
     - `connect-src` de `local.csp_report_only`: `compact(["'self'", var.backend_url, var.cognito_domain_url])`. Sigue en Report-Only.
     - `aws_amplify_branch.this.environment_variables` suma `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID`.
   - Restricciones del comentario dentro del mapa (regex lazy `\{([\s\S]*?)\n\s*\}` de `docs-check`, ~línea 380): un comentario `#` explica por qué no están en la app (ciclo de `dev`), **sin llaves `{` ni `}`**, sin `${...}` y sin líneas que empiecen por `}`. El mapa se mantiene literal, sin `merge`.
   - Comprobación: `validate`; `docs-check`, sección «Variables de Amplify», con las dos claves nuevas.
   - Norma: BP-11 y mantenimiento sección 3.6. Cambiar `VITE_*` exige compilación nueva del frontend.

3. **Entornos `dev` y `prod`**
   - Archivos: modificar `environments/dev/main.tf`, `environments/prod/main.tf`, `environments/dev/outputs.tf` y `environments/prod/outputs.tf`.
   - Cambios, idénticos en ambos: `module "cognito"` (`source = "../../modules/cognito"`, `environment`, `domain_prefix` literal, `allowed_origins = module.amplify.site_origins`); en `module "amplify"`, `cognito_domain_url = module.cognito.domain_url` y `cognito_client_id = module.cognito.client_id`; en `module "beanstalk"`, `app_env_vars = merge(var.app_env_vars, { COGNITO_USER_POOL_ID = module.cognito.user_pool_id })`; outputs nuevos `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain_url`, `cognito_region`, `cognito_callback_urls` y `cognito_logout_urls` (no son secretos).
   - Únicas divergencias entre entornos: el prefijo del dominio y `deletion_protection`; se explican en el README.
   - Comprobación: `validate` sin ciclo en `dev` ni `prod`.
   - Norma: BP-1 y `para-backend.md` sección 2.

4. **Revertir Parameter Store en `modules/beanstalk`**
   - Archivos: modificar `modules/beanstalk/main.tf` y `variables.tf`.
   - Eliminar de `main.tf`: los `locals` `ssm_secret_names` y `ssm_secret_arns` (se conservan `https_enabled` y `restrict_origin`); los data sources `aws_partition`, `aws_region` y `aws_caller_identity` (solo los usaba SSM); `aws_iam_role_policy.ssm_secrets` y su `depends_on`; el `dynamic "setting"` de `environmentsecrets` y su comentario. Se conserva el `dynamic "setting"` de `app_env_vars` con `for_each = nonsensitive(var.app_env_vars)` (línea 338) sin cambios: es el punto del aviso S6 (decisión 13).
   - En `variables.tf`: la primera `validation` exige las nueve claves del backend (`JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `EMAIL`, `EMAIL_PASSWORD`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN`) más `COGNITO_USER_POOL_ID`, con el `error_message` actualizado; se borra la segunda `validation` (rechazo de secretos); se reescribe la `description` (sin Parameter Store; `COGNITO_USER_POOL_ID` lo inyecta el entorno). `sensitive = true` se conserva.
   - Comprobación: `validate` en ambos entornos; `grep` de `ssm`, `environmentsecrets` y `aws_iam_role_policy` en `modules/beanstalk` sin resultados.
   - Norma: SEG-2 (S6 reabierto), SEG-4 (desaparece la política IAM) y BP-2.

5. **Plantillas `terraform.tfvars.example`**
   - Archivos: modificar `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example`.
   - Sustituir el comentario de Parameter Store por tres claves marcador: `JWT_SECRET`, `ADMIN_PASSWORD` y `EMAIL_PASSWORD`, con reglas en comentarios (JWT de al menos 32 caracteres; `ADMIN_PASSWORD` es un hash bcrypt) y valores `CHANGE_ME_...` sin forma de hash (`quality-check` detecta `$2b$...`). Indicar que se retiran al final de la transición (`S18`). **No** incluir `COGNITO_USER_POOL_ID`: la inyecta Terraform.
   - Comprobación: `docs-check` sección 6 y `quality-check` sin avisos de claves.
   - Norma: BP-2 y mantenimiento sección 2 (fila `app_env_vars`).

## Fase 2 (scripts de verificación y configuración del ciclo)

6. **`scripts/quality-check.mjs`**
   - Sustituir `SSM_SECRET_KEYS` (~línea 367) por `INJECTED_KEYS = ['COGNITO_USER_POOL_ID']`, con comentario «las inyecta Terraform desde Cognito»; ajustar el filtro de ~la línea 375. Añadir `'aws_cognito_user_pool'` a `TAGGABLE` (~línea 62).
   - Comprobación: `node scripts/quality-check.mjs` sin problemas nuevos y con `Component` detectado en el pool. No se añade nada a `KNOWN_DEBT`.
   - Norma: BP-6 y mantenimiento sección 4.

7. **`scripts/docs-check.mjs`**
   - `docAppKeys` (~líneas 458-462) deja de leer `Secretos en Parameter Store` y lee `app_env_vars` más `Claves inyectadas por Terraform`; actualizar el comentario.
   - Sección 6 (~línea 351): `docKeys` sigue leyendo solo `app_env_vars`. `COGNITO_USER_POOL_ID` vive en la sección nueva `## Claves inyectadas por Terraform` y **no** en la tabla de `app_env_vars` (si estuviera, la sección 6 marcaría «falta la clave» en los ejemplos). La sección nueva debe ser un encabezado hermano, no hijo, de `app_env_vars`, para que `section()` no la absorba; se comprueba ejecutando `docs-check`.
   - Para el aviso entre repositorios (~líneas 469-474), la fila de `COGNITO_USER_POOL_ID` lleva «No» mientras el backend no la exija y pasa a «Sí» cuando la exija.
   - Comprobación: `node scripts/docs-check.mjs` y `--strict`; `--strict` fallará hasta que el frontend añada `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` a su `.env.example` (aviso entre repositorios esperado, va al aviso de PR y no se silencia).

8. **`.claude/flujo.json`** (decisión 4 del usuario)
   - Archivo: modificar `.claude/flujo.json`. En `areasContrato`, añadir `"modules/cognito/**"` tras `"modules/dns/**"`. En `docsPorArea`, añadir `"modules/cognito/**"` con `docs/referencia-modulos.md`, `docs/integracion/para-backend.md`, `docs/integracion/para-frontend.md` y `docs/guias/seguridad.md`. Sin otros cambios; `.claude/settings.json` no se toca.
   - Comprobación: `node plugins/ciclo-agentico/scripts/docs-gate.mjs --solo-validar` pasa; `node --test "plugins/**/tests/**/*.test.mjs"` como comprobación barata (los tests usan carpetas temporales y no leen el `flujo.json` del repositorio, **por confirmar** más allá de `flujo.test.mjs`).
   - Efecto colateral: `.claude/**` está en `docsPorArea` con `docs/guias/mantenimiento.md`, que el tester debe actualizar.
   - Norma: mantenimiento sección 2 y `CLAUDE.md` (no debilitar `.claude/settings.json`).

## A cargo del tester-documentador

Cifras: no repetir «N módulos/recursos/variables» fuera de `estado` y `mantenimiento` (falla `docs-check`).

1. **Contratos.**
   - `docs/integracion/para-backend.md`: fecha y resumen; sección 2 con las nueve claves otra vez en `app_env_vars`; eliminar «Secretos en Parameter Store: procedimiento humano». Contrato de login (solo nombres): `COGNITO_USER_POOL_ID` y los puntos de la decisión 6 (`iss` exacto, `token_use=access`, `exp`, RS256 fijo, caché de JWKS; hoy solo HS256 sin JWKS; convivencia por probar un verificador y luego el otro). Tareas del backend: añadir `COGNITO_USER_POOL_ID` a `validateEnv.js`; retirar `POST /log`, `JWT_SECRET` y `ADMIN_*` al final; `client_id` y grupos no se validan (`C16`, con «cualquier usuario del pool es administrador» y la vía de salida). Sección 7 (coherencia entre `ALLOWED_ORIGIN` y los orígenes de `cognito_callback_urls`) y sección 10 (sustituir la fila de secretos).
   - `docs/integracion/para-frontend.md`: tabla de variables con las dos `VITE_*` nuevas, **solo en la rama**; `connect-src` con el dominio de Cognito; rutas `/auth/callback` y `/` por `window.location.origin`; **requisito PKCE** S256; tareas (login, almacenar y enviar el token, expiración y refresco, `.env.example`, `docs/integracion/para-infra.md` del frontend y su CSP); orden de despliegue en la sección 4.
   - Orden común: (1) infra aplica `dev` y luego `prod` (comprobar pool, dominio, cliente, Beanstalk en Green con `COGNITO_USER_POOL_ID`, Hosted UI cargando y administradores creados); (2) backend aceptando ambos tokens, en `dev` y luego `prod`; (3) frontend con build nuevo; (4) retirar el login antiguo (backend primero, después infra) **con la condición de la decisión 10 (TOTP verificado en `prod` para los dos administradores)** y pasado el plazo fijo (`S18`). Vuelta atrás: frontend con el build anterior y backend con la versión anterior; infra solo con cambio revisado y con el frontend ya sin Cognito (en `prod`, `deletion_protection`).
   - **Procedimiento humano de alta de administrador**, sin contraseñas ni valores: `admin-create-user` por correo con contraseña temporal entregada por Cognito; primer acceso por el Hosted UI (cambiar contraseña y registrar TOTP); comprobación de solo lectura; **segundo administrador de emergencia** (decisión 9); restablecimiento si se pierde el TOTP (acción que cambia recursos, solo el humano y con confirmación).
2. **Referencia, README y costes.**
   - `docs/referencia-modulos.md`: sección «Módulo cognito» con variables y outputs; Amplify (variables nuevas, `site_origins`, `VITE_COGNITO_*` «solo rama» con el motivo); Beanstalk (`app_env_vars` y su `validation`); «Entorno dev» y «Entorno prod» con los outputs nuevos de Cognito (los `cognito_*`); tabla `app_env_vars` con las nueve claves; sección nueva `## Claves inyectadas por Terraform`; eliminar `## Secretos en Parameter Store` y la línea sobre `environmentsecrets` con su enlace al plan antiguo.
   - `README.md`: bloque «Arquitectura» con `cognito/ — ...` (formato exigido por `docs-check`) y tabla de recursos; divergencia de `deletion_protection` en `prod` (`dev` sin protección); «Destruir un entorno» y sección de secretos; fila de iteración con spec, plan y aviso de PR; marcar como revertida la fila de Parameter Store.
   - `docs/billing-tags.md`: `identity` y su coste estimado (Cognito Essentials para un MAU, **por confirmar**).
3. **Guías.**
   - `docs/guias/seguridad.md`: SEG-2, SEG-3 y SEG-4 dejan de afirmar Parameter Store, `sigmetum-ssm-secrets` y `environmentsecrets`; SEG-2 dice con claridad el aviso de la decisión 13; `SEG-13` propuesto (controles de infra verificables y PKCE solo como requisito del frontend).
   - `docs/guias/mantenimiento.md`: sección 4 (`docAppKeys` e `INJECTED_KEYS`), checklist «Amplify» (paridad app/rama para `VITE_COGNITO_*`) y `.claude/**` por el paso 8.
   - `docs/guias/buenas-practicas-terraform.md`: BP-2 (las nueve claves); **BP-8** (hoy solo habla de buckets): `deletion_protection = ACTIVE` en `prod` para el pool y `dev` sin protección (aceptado); BP-12 (S6).
   - `docs/aws-organizations-setup.md`: borrar el párrafo de la política SSM.
4. **`docs/estado-y-deuda-tecnica.md`.** «Última actualización: 31/10/2026» y revisión nueva (la de Parameter Store pasa a «revertida»); métricas con `--metrics`; S2 y S6 reabiertos con alcance reducido; ids nuevos `S18` (retirada del login antiguo, plazo fijo y condición del TOTP), `C16` (con consecuencia y vía de salida) y `C17` si el `.env.example` del frontend queda por actualizar; **(por confirmar)** para región, atributos, límites y todo lo que dependa de la cuenta.
5. **Residuos del commit `0885804` y aviso de PR.**
   - Los tres documentos `docs/specs/2026-10-31-secretos-beanstalk-{design,plan,aviso-pr}.md` afirman una arquitectura revertida. No se borran ni renombran (README y referencia los enlazan y `docs-check` valida enlaces): se añade bajo el título de cada uno `Estado: revertido el 31/10/2026 por [login con Cognito](2026-10-31-cognito-login-design.md)`.
   - Aviso de PR `docs/specs/2026-10-31-cognito-login-aviso-pr.md` con la sección «Frontend y backend» de `.github/pull_request_template.md`, solo nombres de claves: qué hace cada repositorio y en qué orden desplegar; **S6 reabierto** con las palabras de la decisión 13; la condición del TOTP antes del paso 4; `C16`; y que `--strict` falla hasta que el frontend actualice `.env.example`.

## Pruebas

- Sin pruebas nuevas: no se toca `plugins/` salvo `.claude/flujo.json`, que los tests no leen.
- Verificación, en este orden: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `environments/dev` y `environments/prod`; `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs`, `--strict` (se espera el aviso entre repositorios) y `--metrics`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs --solo-validar` y luego sin `--solo-validar`; `node --test "plugins/**/tests/**/*.test.mjs"`.
- Comprobaciones específicas: `docs-check` sección 6 no marca `COGNITO_USER_POOL_ID`; la regex de ~línea 380 sigue encontrando el mapa de `aws_amplify_branch`.
- Sin `terraform plan` ni `apply` en los roles. En el `plan` humano se espera solo creaciones de identidad, la clave `COGNITO_USER_POOL_ID`, las tres claves de secretos de vuelta en `app_env_vars` y ningún reemplazo ni destrucción **(por confirmar)**. El humano no pega esa salida: puede mostrar los secretos (decisión 13).
- Si el humano ya quitó las tres claves de su `terraform.tfvars`, la `validation` falla en `plan` y hay que reponerlas (falla cerrado, es lo esperado). El `.lock.hcl` no cambia.

## Cierre

- **Crítico: sí** (entradas de `criticidad`: IAM y permisos; secretos y `terraform.tfvars`; contrato con el frontend y el backend; destrucción o reemplazo de recursos; CI por el paso 8).
- Documentos de integración afectados: `para-backend.md` (secciones 1, 2, 7 y 10) y `para-frontend.md` (secciones 2, 3, 4 y 6).
- Segunda opinión: incorporada la de la v1 (puntos a a g); la v2 puede volver a revisarse por el cambio en `.claude/flujo.json`.

## Riesgos para la puerta

1. **S6 reabierto:** `JWT_SECRET`, `EMAIL_PASSWORD` y el hash admin vuelven a ser propiedades de entorno, visibles en `plan` y estado (`modules/beanstalk/main.tf:338`).
2. **`C16`:** sin `client_id` ni grupos, cualquier usuario del pool es administrador; válido solo con registro cerrado.
3. **`username_attributes = ["email"]` es inmutable:** cambiarlo reemplaza el pool y borra usuarios, y `deletion_protection` en `prod` impide arreglarlo por `apply`.
4. **Bloqueo por pérdida de TOTP:** `admin_only` y un administrador; mitigado con el segundo administrador y con no ejecutar el paso 4 hasta verificar el TOTP en `prod`.
5. **Sin contrastar:** Cognito en `eu-west-3`, `explicit_auth_flows` solo con refresco, el prefijo de dominio (único por región) y que el backend actual solo acepta HS256 sin JWKS. `--strict` y el build del frontend no pasan hasta que backend y frontend actualicen `validateEnv.js` y `.env.example`, y el `apply` de Beanstalk reinicia el backend.
