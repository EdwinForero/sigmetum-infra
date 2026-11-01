# Aviso para PR: login de administrador con Amazon Cognito

Fecha: 2026-10-31 · Spec: `docs/specs/2026-10-31-cognito-login-design.md` · Plan: `docs/specs/2026-10-31-cognito-login-plan.md`

Crítico: sí (IAM y permisos; secretos y `terraform.tfvars`; contrato con el frontend y el backend; destrucción o reemplazo de recursos; CI por `.claude/flujo.json`). Solo marcadores y nombres: ningún valor, hash ni ARN con cuenta.

Integración: sí hay impacto: se actualizan `docs/integracion/para-backend.md` (secciones 1, 2, 7 y 10) y `docs/integracion/para-frontend.md` (secciones 1, 2, 3, 4 y 6).

## Qué cambia

- `modules/cognito` (nuevo): pool de usuarios (MFA TOTP `ON`, registro cerrado, contraseña de 14 caracteres, recuperación `admin_only`, `deletion_protection` solo en `prod`, `Component = "identity"`), dominio del Hosted UI y cliente público sin secreto con flujo `code`. Nombre del cliente `<app_name>-<env>-web` (por confirmar).
- `environments/dev` y `environments/prod`: `module "cognito"` con `allowed_origins = module.amplify.site_origins`, `COGNITO_USER_POOL_ID` inyectada en `app_env_vars` con `merge`, y seis outputs `cognito_*`. Divergencias entre entornos: el prefijo del dominio (`sigmetum-a-dev` y `sigmetum-a-prod`) y `deletion_protection` (**`dev` sin protección: aceptado por el usuario**).
- `modules/amplify`: variables `cognito_domain_url` y `cognito_client_id`, output `site_origins` (comparte `local.branch_url` con `branch_url`), dominio de Cognito en el `connect-src` de la CSP (sigue en Report-Only) y `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` **solo en la rama** (ciclo de `dev`).
- `modules/beanstalk`: se revierte Parameter Store (commit `0885804`): fuera `environmentsecrets`, la política IAM `sigmetum-ssm-secrets-<env>` y los data sources de SSM; `app_env_vars` vuelve a exigir las nueve claves del backend más `COGNITO_USER_POOL_ID`.
- Plantillas `.example`: otra vez `JWT_SECRET`, `ADMIN_PASSWORD` y `EMAIL_PASSWORD` como marcadores `CHANGE_ME_...` (se retiran con `S18`); sin `COGNITO_USER_POOL_ID`.
- `scripts/quality-check.mjs` (`INJECTED_KEYS`, `aws_cognito_user_pool` en `TAGGABLE` y cinco reglas de Cognito que hacen fallar: MFA `ON` con TOTP, alta solo por administrador, cliente sin secreto, sin `localhost` en `modules/cognito` ni `environments`, sin flujos de contraseña por API; sin deuda en `KNOWN_DEBT`) y `scripts/docs-check.mjs` (`docAppKeys` lee `Claves inyectadas por Terraform`); `.claude/flujo.json` (`modules/cognito/**` en `areasContrato` y `docsPorArea`).
- Documentación: referencia, README, `billing-tags.md`, los dos documentos de integración, `seguridad.md` (SEG-2, SEG-3, SEG-4 y `SEG-13` propuesto), `mantenimiento.md`, `buenas-practicas-terraform.md` (BP-2, BP-8, BP-12), `aws-organizations-setup.md`, `estado-y-deuda-tecnica.md` y los tres documentos de `secretos-beanstalk` marcados como revertidos.

## Avisos para quien revisa (leer antes de aprobar)

1. **S6 reabierto.** Al revertir `0885804`, `JWT_SECRET`, `EMAIL_PASSWORD` y el hash `ADMIN_PASSWORD` **vuelven a viajar como propiedades de entorno de Beanstalk**. `for_each = nonsensitive(var.app_env_vars)` (`modules/beanstalk/main.tf`) quita la marca de sensible: **pueden verse en la salida de `terraform plan` y en el estado**. No se asume que el proveedor oculte `setting.value`. Mitigaciones existentes: estado cifrado (`aa4b508`) y la regla de no pegar la salida del `plan`. **No pegues el `plan` de este cambio en la PR ni en un chat.**
2. **`C16` (aceptado por el usuario).** El backend valida firma por JWKS, `iss`, `token_use`, `exp` y RS256, pero **no valida `client_id` ni grupos: cualquier usuario del pool es administrador**. Válido solo con el registro cerrado (`allow_admin_create_user_only = true`) y un pool con solo administradores. Vía de salida: validar `client_id` o un grupo `admin` en el backend (cambio de spec).
3. **Condición del TOTP antes del paso 4.** El paso 4 (retirar el login antiguo: backend y después infra, `S18`) **NO se hace hasta verificar en `prod` que el TOTP funciona**: inicio de sesión por el Hosted UI con MFA y comprobación del segundo administrador (de emergencia, otra persona, otro correo, su propio TOTP). Con `admin_only` y un solo administrador, perder el TOTP bloquea el acceso.
4. **`username_attributes = ["email"]` es inmutable:** cambiarlo reemplaza el pool y borra usuarios y TOTP; en `prod`, `deletion_protection` impide arreglarlo con `apply` sin un cambio revisado.
5. **`--strict` falla hasta que el frontend actualice `.env.example`.** `node scripts/docs-check.mjs --strict` solo debe fallar por el aviso entre repositorios de `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` (frontend `C17`); no se silencia. El build del frontend tampoco las lee todavía.
6. **Sin contrastar (por confirmar):** Cognito en `eu-west-3`, los atributos del proveedor `aws ~> 5.0`, que un cliente solo con `ALLOW_REFRESH_TOKEN_AUTH` sea aceptado (si el `apply` lo rechaza, se pregunta; no se añade SRP en silencio), que el prefijo de dominio esté libre, la paridad rama/app de `VITE_*` y que el `apply` de Beanstalk reinicia el backend.

## Frontend y backend

- Afecta al contrato con el frontend y con el backend: **sí**.
- **Frontend:** añadir `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` a su `.env.example` y leerlas; login por el Hosted UI con **PKCE S256** (requisito del frontend, no de infra); rutas `/auth/callback` y `/` por `window.location.origin`; almacenar y enviar el token de acceso, gestionar expiración y refresco; actualizar su `docs/integracion/para-infra.md` y su CSP; compilación nueva (las `VITE_*` van incrustadas).
- **Backend:** añadir `COGNITO_USER_POOL_ID` a `config/validateEnv.js` (hoy la referencia la marca «No»; pasa a «Sí» cuando la exija); verificador de Cognito con `iss` exacto, `token_use = access`, `exp`, **RS256 fijo en `algorithms`** y caché de JWKS con rotación y límite de peticiones, **en convivencia con el HS256 actual** (primero el antiguo, luego el de Cognito; nunca enrutar por el `alg` del cabecero); al final (`S18`), retirar `POST /log`, `JWT_SECRET` y `ADMIN_*`. `ALLOWED_ORIGIN` debe coincidir con los orígenes de `cognito_callback_urls`.
- **Orden de despliegue:** (1) infra: `apply` en `dev` y luego en `prod` (el humano; comprobar pool, dominio, cliente, Beanstalk en `Green` con `COGNITO_USER_POOL_ID`, Hosted UI cargando y administradores creados con el procedimiento de `para-backend.md`); (2) backend aceptando ambos tokens, en `dev` y luego `prod`; (3) frontend con compilación nueva; (4) retirar el login antiguo (backend y después infra) **solo tras verificar el TOTP en `prod` para los dos administradores** y pasado el plazo fijo (`S18`). Vuelta atrás: frontend con el build anterior y backend con la versión anterior; infra solo con un cambio revisado y con el frontend ya sin Cognito (en `prod`, `deletion_protection`).

## Qué debe hacer el humano

1. Reponer en su `terraform.tfvars` de cada entorno las tres claves `JWT_SECRET`, `ADMIN_PASSWORD` y `EMAIL_PASSWORD` en `app_env_vars` si ya las había quitado (`plan` falla por la `validation`: falla cerrado, es lo esperado). No añadir `COGNITO_USER_POOL_ID`: la inyecta Terraform.
2. `terraform plan` y `apply` en `dev` y luego en `prod`, sin pegar la salida. Se espera solo creaciones de identidad, la clave `COGNITO_USER_POOL_ID`, las tres claves de secretos de vuelta y ningún reemplazo ni destrucción **(por confirmar)**.
3. Crear los administradores (dos por entorno) y verificar el TOTP, con el procedimiento de `docs/integracion/para-backend.md#procedimiento-humano-de-alta-de-administrador`.
4. Si existían los parámetros de Parameter Store y la política IAM `sigmetum-ssm-secrets-<env>` de `0885804`, retirarlos aparte con confirmación expresa (Terraform ya no los gestiona; si la política llegó a aplicarse, su baja aparecerá en el `plan`, **por confirmar**).

## Impacto en costes

Cognito en el nivel Essentials para un solo usuario activo al mes: despreciable (**por confirmar** en la calculadora de AWS). Etiqueta nueva `Component = "identity"` (`docs/billing-tags.md`); hay que activarla en Cost Explorer.

## Diagramas

`docs/diagramas/arquitectura-dev.html` y `arquitectura-prod.html` regenerados el 31/10/2026: un nodo de Cognito (pool, Hosted UI y cliente público), la flecha de login desde el navegador, la flecha punteada de claves JWKS desde Beanstalk, y una nota con las variables (`COGNITO_USER_POOL_ID`, `VITE_COGNITO_*` solo en la rama), la transición del login antiguo y la diferencia entre entornos. La geometría de los conectores se revisó a mano, sin el verificador del repositorio de la skill.
