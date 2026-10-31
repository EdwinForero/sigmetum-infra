# Integración con el backend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-backend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios). El backend no tiene un documento `para-infra.md` equivalente: su contrato con esta infraestructura es `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js`, que se citan aquí.

- Lo verificado contra el código de Terraform y del backend está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 31/10/2026, `ALLOWED_ORIGIN` de prod con dos orígenes). Infraestructura: rama `feature/testing`, commit base `9128987` (cambios sin commitear). Backend: rama `feature/sigmetum_v2`, commit `a2dadb9`.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| ~~**infra:C5**~~ | ~~`app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`~~ | ~~El backend no arranca~~ | **Resuelto** — plantillas `.example` y referencia incluyen todas las obligatorias **(verificado)** |
| ~~**infra:C6**~~ | ~~`HealthCheckPath` de Beanstalk es `/`~~ | ~~El entorno puede figurar como no saludable~~ | **Resuelto** (`feature/testing` de infra): `HealthCheckPath = "/healthcheck"` **(verificado)** |
| ~~**backend:B1**~~ | ~~El backend no configuraba `trust proxy`~~ | ~~IP del balanceador compartida por todos los usuarios en el rate-limiter~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', ...)` en `app.js`, con los saltos fijados por `TRUST_PROXY_HOPS` (1 si no se define) **(verificado)** |
| **backend:I7** | `TRUST_PROXY_HOPS` no está en `app_env_vars`: el backend usa 1 salto por defecto | Si los saltos reales difieren, el limitador de intentos agrupa mal las IP o se esquiva con `X-Forwarded-For` | **Abierto (prioridad alta)**: infra mide los saltos y la fija en `app_env_vars` **antes de que el backend despliegue la entrega 2 de M21** (`POST /send-email` pública; condición del backend en su `para-infra.md`, sección 6) (no es `frontend:I7`) |
| **infra:S15** (dependencia del `apply`) | El backend ya trata `AccessDenied` como "no existe" en lecturas (`GET /list-terms`, `GET /get-data/:path(*)`), pero no en las rutas que escriben (`upload-term`, `delete-term`), a propósito | Tras acotar `s3:ListBucket` por `Prefix` (infra:S7), una clave inexistente da `AccessDenied` y no `NoSuchKey` **(por confirmar el estado exacto)**. En `dev`, `data/terms/noLatinTerms.json` no existe (verificado el 31/10/2026): `/list-terms` da `200` con lista vacía, pero la primera alta de término fallaría con 500 | **Abierto, para quien despliega**: subir `data/terms/noLatinTerms.json` con `[]` a dev y prod (comando en la sección 5); el backend no cambia |

## 2. Contrato de entorno: `app_env_vars` frente a `validateEnv.js`

El backend exige estas variables al arrancar (`config/validateEnv.js`, verificado). Solo se listan **nombres**, nunca valores. Además de existir, algunas tienen reglas de valor (validación estricta):

| Variable | Exigida por el backend | La define `app_env_vars` hoy | Es secreto |
|---|---|---|---|
| `JWT_SECRET` | Sí | Sí | Sí |
| `JWT_EXPIRATION` | Sí | Sí | No |
| `ADMIN_USERNAME` | Sí | Sí | No |
| `ADMIN_PASSWORD` | Sí | Sí | Sí (hash bcrypt) |
| `EMAIL` | Sí | Sí | No |
| `EMAIL_PASSWORD` | Sí | Sí | Sí |
| `AWS_REGION` | Sí | Sí (`eu-west-3`) | No |
| `AWS_BUCKET_NAME` | Sí | Sí (`sigmetum-app-assets-dev` / `sigmetum-app-assets-prod`) | No |
| `ALLOWED_ORIGIN` | Sí | Sí (vacío en dev hasta conocer la URL de Amplify) | No |
| `AWS_PROFILE` | Solo si `NODE_ENV=local` | No aplica (Beanstalk no usa `NODE_ENV=local`) | No |
| `TRUST_PROXY_HOPS` | No (opcional; 1 si no se define) | No (`backend:I7`) | No |

**Reglas de valor (verificado en `config/validateEnv.js` y `config/trustProxy.js`; solo reglas, sin valores):**

- `JWT_SECRET`: al menos 32 caracteres.
- `ADMIN_PASSWORD`: un hash bcrypt completo.
- `JWT_EXPIRATION`: duración con unidad y mayor que cero (un número sin unidad es inválido).
- `TRUST_PROXY_HOPS`: entero de 1 a 5; el 0 solo con `NODE_ENV` `local` o `test`.
- Con `NODE_ENV` distinto de `local` y `test`, un valor inválido **impide el arranque**; con `local` o `test` solo avisa. **No definir `NODE_ENV` como `local` ni `test` en Beanstalk** (estaría relajando la validación).
- Si los valores reales de `terraform.tfvars` cumplen estas reglas: **(por confirmar)**; no se leen. Un valor incumplidor haría que el backend no arranque tras el despliegue.

Las plantillas `environments/*/terraform.tfvars.example` incluyen todas las claves obligatorias. Los `terraform.tfvars` reales (fuera de git) deben tenerlas aplicadas por quien despliega.

**Cómo llegan hoy:** como propiedades de entorno del entorno de Beanstalk (`dynamic "setting"` sobre `app_env_vars`, namespace `aws:elasticbeanstalk:application:environment`, verificado en `modules/beanstalk/main.tf`). Son legibles en la consola por quien pueda ver la configuración del entorno (hallazgo de seguridad [S6](../estado-y-deuda-tecnica.md#abiertos)).

## 3. Health check

- Beanstalk comprueba `HealthCheckPath = "/healthcheck"` **(corregido en rama `feature/testing` de infra; antes era `/`)**.
- El backend responde `200 ok` en `/healthcheck` (`app.js`, verificado). Resuelve infra:C6.
- Efecto confirmado tras el primer despliegue: **(por confirmar)**.

## 4. HTTPS, ALB y DNS

| Entorno | HTTPS | Balanceador | DNS |
|---|---|---|---|
| `dev` | Sí — CloudFront termina HTTPS delante de Beanstalk (`enable_cdn = true`) **(verificado)** | CloudFront → Beanstalk single (sin ALB) | Ninguno (dominio de CloudFront) |
| `prod` | Sí, si `ssl_certificate_arn` está definido | ALB (autoescalado 1–3) | `backend.sigmetum-a.org` (CNAME al endpoint de Beanstalk, `modules/dns`) |

**(verificado en `environments/*/main.tf` y `modules/dns/main.tf`).**

En `prod`, con ALB y certificado, el listener 80 redirige con 301 a HTTPS (443) (`aws_lb_listener_rule.http_to_https`, `modules/beanstalk/main.tf`, verificado en código; efecto **(por confirmar)** tras el `apply` en prod). Afecta a todo cliente HTTP, no solo al navegador; en `dev` no cambia.

### Cabeceras `X-Forwarded-*` y `trust proxy`

El ALB de prod (y CloudFront en dev) añaden `X-Forwarded-For` y `X-Forwarded-Proto` a las peticiones. El backend configura `app.set('trust proxy', ...)` en `app.js` **(B1 resuelto, 03/10/2026)** con el número de saltos de `TRUST_PROXY_HOPS` (opcional; 1 si no se define; entero de 1 a 5, el 0 solo con `NODE_ENV` `local` o `test`, `config/trustProxy.js`, verificado): Express y el limitador de `express-rate-limit` leen la IP real del cliente. Infra no fija hoy la variable y el recuento real de saltos de cada entorno no está medido: `backend:I7` abierto (**por confirmar**).

## 5. Permisos IAM de S3

La política que `modules/storage` añade al rol `aws-elasticbeanstalk-ec2-role` tiene dos sentencias (`modules/storage/main.tf`, verificado en código; efecto aplicado **(por confirmar)** hasta el `apply`):

| Sentencia | Acciones | Recurso | Condición |
|---|---|---|---|
| `ObjectsInGalleryAndData` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | `gallery/*` y `data/*` del bucket del entorno | — |
| `ListGalleryAndData` | `s3:ListBucket` | El bucket | `StringLike` en `s3:prefix`: `gallery/*` o `data/*` |

**Prefijos efectivos que debe respetar el backend:** `gallery/` y `data/` (esto cubre `data/active/`, `data/terms/`, `data/drafts/` y `data/<provincia>/`; `config/s3Paths.js`, verificado). **Sin acceso** para el rol a `assets/`, a la raíz del bucket ni a ningún otro prefijo: esos accesos darán acceso denegado. `assets/*` queda solo para CloudFront.

**Regla del listado:** todo `listObjectsV2` debe llevar `Prefix` con barra final dentro de `gallery/` o `data/`. Un listado sin `Prefix`, de la raíz o con `data` o `gallery` sin barra se deniega. Hoy solo hay un punto que lista, `listAllObjects` (`aws/awsS3connect.js`), y su `Prefix` siempre lleva barra final porque `listFilesInS3Folder` y `getPresignedUrlsFromS3Folder` lo normalizan (verificado). Llamadores:

| Llamador | Prefix enviado | Dentro de `gallery/` o `data/` |
|---|---|---|
| `getPresignedUrlsFromS3Folder` desde `routes/content.js:70` | `gallery/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:63` (`list-files`) | `data/` | Sí |
| `getMergedDataInS3Folder` desde `routes/data.js:93` | `data/active/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:44, 144, 200` | `data/<provincia>/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:53, 184` | `data/drafts/<provincia>/` | Sí |

Las URL prefirmadas se firman con el rol de instancias, así que la lectura de `gallery/` y `data/` sigue permitida. Usa las acciones `GetObjectCommand`, `PutObjectCommand` (vía `s3.putObject`), `DeleteObjectCommand` (vía `s3.deleteObject`) y `ListObjectsV2Command` (verificado); sin `PutObjectAcl` ni multipart.

**Un prefijo nuevo exige cambiar la política de infra antes** de que el backend lo use: si no, falla con acceso denegado.

**Nota 403 frente a 404 (por confirmar en dev):** S3 devuelve 404 `NoSuchKey` para una clave inexistente solo si quien llama tiene `s3:ListBucket` sin una condición que impida evaluarlo; `GetObject` no lleva `s3:prefix`, así que con el listado condicionado probablemente devuelva 403 `AccessDenied`. **Actualizado el 31/10/2026 (verificado en el código del backend):** `getTextJsonS3` (`aws/awsS3connect.js`) trata `AccessDenied` como lista vacía solo con la opción `vacioSiAccessDenied`, que usa `GET /list-terms`; `GET /get-data/:path(*)` valida la clave y responde 404 ante `AccessDenied`. Las rutas que escriben (`upload-term`, `delete-term`) **no** lo hacen, a propósito: un permiso roto no debe sobrescribir el glosario con `[]`. Consecuencia: si `data/terms/noLatinTerms.json` no existe, `/list-terms` da `200` con lista vacía, pero la primera alta de término (`upload-term`) responde 500. En `dev` el archivo no existe (verificado el 31/10/2026): hay que crearlo con `[]`.

**Tarea de infra.S15 (estado a 31/10/2026):** el backend ya trata `AccessDenied` en lecturas y valida la clave de `GET /get-data/:path(*)` (responde `400` `Invalid path` a rutas fuera de su lista de permitidos, verificado en `dev`). Falta crear `data/terms/noLatinTerms.json` con `[]` en `dev` y `prod` antes de la primera alta de término; no se debe tratar `AccessDenied` en las rutas de escritura. Prueba pendiente: dar de alta un término en `dev` con el archivo creado (por confirmar).

**Orden de despliegue:** el **backend se despliega ANTES del `apply` de infra**. Mitigación temporal si no puede ser: subir antes un `data/terms/noLatinTerms.json` con `[]` a dev y a prod, con el perfil de cada cuenta (marcadores, sin valores reales):

```bash
echo '[]' > noLatinTerms.json
aws s3 cp noLatinTerms.json s3://<bucket>/data/terms/noLatinTerms.json --profile <perfil-de-la-cuenta>
```

Esto ya no es solo una mitigación temporal: el archivo debe existir para que la primera alta de término funcione, porque el backend no trata `AccessDenied` en las rutas que escriben. `GET /get-data/<clave inexistente>` ya lo trata el backend. Ver [S7 y S15](../estado-y-deuda-tecnica.md).

**TLS y redirección:** el bucket deniega toda petición sin TLS (`aws:SecureTransport`); el SDK usa HTTPS por defecto, así que no cambia nada. En `prod`, tras el `apply`, el listener 80 del ALB redirige con 301 a HTTPS (443) para **todo** cliente HTTP; `app_env_vars` no cambia y el health check (grupo de destino, puerto 80 de la instancia) no pasa por el listener **(por confirmar)**.

## 6. Plataforma, tamaño de instancia y correo saliente

- **Plataforma:** `64bit Amazon Linux 2023 v6.11.9 running Node.js 22` (`modules/beanstalk/variables.tf`, verificado). El `package.json` del backend fija `engines.node` en `"22"` (B3, verificado), coherente con la plataforma.
- **Tamaño de instancia:** `t3.nano` en ambos entornos (verificado). El backend procesa ficheros Excel en memoria (`convertExcelToJson`, en `aws/awsS3connect.js` y otros); no hay una cifra de tamaño máximo de fichero ni una medición de uso de memoria con `t3.nano` (**por confirmar**; si los Excel crecen, puede haber que subir el tipo de instancia).
- **Correo saliente:** el backend usa `nodemailer` contra `smtp.gmail.com` (`routes/content.js`, verificado) con `EMAIL`/`EMAIL_PASSWORD`. Sale por el puerto SMTP habitual (587/465); el grupo de seguridad de salida de Beanstalk no está restringido en este repositorio (egress por defecto), así que no debería bloquearlo (**por confirmar** en la cuenta real).
- **Despliegue:** GitHub Actions con OIDC (módulo `backend-ci-iam`). Push a `feature/testing` → dev; push a `master` → prod. Solo despliega si el job `verify` (lint, quality, docs:check, `npm test` y `npm audit --audit-level=high`) pasa. Ver sección 9.

## 7. `ALLOWED_ORIGIN` por entorno

El backend acepta **una lista de orígenes separados por coma** en `ALLOWED_ORIGIN`. La función CORS en `app.js` divide el valor por `,`, elimina espacios, e invoca el callback con `true` si el origen del request está en la lista o si no hay origen (llamadas server-side). Si no coincide, rechaza con error (verificado).

```
ALLOWED_ORIGIN = "https://feature-testing.d37662kpg8985h.amplifyapp.com,https://main.d37662kpg8985h.amplifyapp.com"
```

| Entorno | Qué poner en `ALLOWED_ORIGIN` | Estado |
|---|---|---|
| `dev` | URL(s) de las ramas activas en Amplify, separadas por coma | Por fijar — añadir la URL de cada rama que necesite acceder al API |
| `prod` | Los dos orígenes del frontend, con el formato `https://<dominio>,https://www.<dominio>` (solo marcadores aquí; el dominio es el de la zona de `prod`, infra:C9). Sin barra final, y la comparación es exacta y sensible a mayúsculas (`includes` sobre cada origen tras `trim`; `validateEnv.js` solo exige que la variable exista, **verificado** en `app.js` y `config/validateEnv.js` del backend) | **Por fijar por una persona** en el `terraform.tfvars` de `prod` y aplicar el backend **antes** de que el frontend sirva desde el dominio nuevo |

**Dependencia de orden (infra:C9):** el dominio de `prod` lo crea `modules/amplify` en el `apply` de `prod`; el backend debe aceptar los dos orígenes antes, o el frontend recibiría 403 por CORS. El dominio por defecto de Amplify (`*.amplifyapp.com`) de `prod` no estará en la lista y el backend le dará 403 por CORS. Ver [para-frontend.md](para-frontend.md#4-orden-de-despliegue) (punto 5) para el orden completo. En `dev`, `ALLOWED_ORIGIN` sigue dependiendo de una URL que solo se conoce después de desplegar Amplify.

## 8. Discrepancias

| Id | Qué pasa | Dónde | Responsable | Qué hacer |
|---|---|---|---|---|
| **B1** | ~~Sin `trust proxy`, el límite de intentos de login puede agruparse por la IP del balanceador~~ | `../sigmetum-backend/app.js` | backend | **Resuelto (04/10/2026):** `trust proxy` añadido en commit `7748a1c`; hoy en `app.js`, con `TRUST_PROXY_HOPS` |
| **backend:I7** | `TRUST_PROXY_HOPS` sin fijar en `app_env_vars` (1 salto por defecto) | `modules/beanstalk/main.tf` | infra y backend | Infra mide los saltos de cada entorno y fija la variable. **Condición del backend:** es obligatorio **antes de desplegar la entrega 2 de M21** (`POST /send-email` pública); origen: `sigmetum-backend/docs/integracion/para-infra.md`, sección 6 (límite de `POST /send-email`) y fila I7 de la tabla de discrepancias. El backend no cambia código, pero no debe desplegar esa entrega hasta que infra lo confirme |
| **B2** | ~~La política IAM de S3 da escritura y borrado sobre todo el bucket~~ | `modules/storage/main.tf` | infra | **Resuelto en código (30/10/2026), dependiente de infra:S7:** la política se limita a `gallery/*` y `data/*` (sección 5). Efecto aplicado **(por confirmar)**; el backend debe tratar `AccessDenied` antes del `apply` (infra:S15) |
| **B3** | ~~`package.json` del backend no fija `engines.node`~~  | `../sigmetum-backend/package.json` | backend | **Resuelto (03/10/2026):** `"engines": { "node": "22" }` añadido |

## 9. CI: despliegue automático desde GitHub Actions

Push a `feature/testing` → despliega en `sigmetum-backend-dev-env`. Push a `master` → despliega en `sigmetum-backend-prod-env`. El deploy solo ocurre si el job `verify` (lint, quality, docs:check, `npm test` y `npm audit --audit-level=high`) pasa.

**Autenticación:** OIDC — sin claves de AWS en GitHub. El rol IAM `sigmetum-backend-ci-{env}` se crea con Terraform (`modules/backend-ci-iam/`) y su ARN aparece en el output `ci_role_arn` de cada entorno.

**Variables que hay que configurar en GitHub Actions del repo backend** (Settings → Variables):

| Variable | Valor (output de Terraform) |
|----------|-----------------------------|
| `AWS_ROLE_DEV` | output `ci_role_arn` del entorno dev |
| `AWS_ROLE_PROD` | output `ci_role_arn` del entorno prod |

El bucket de staging lo deriva el workflow del account ID al correr (`elasticbeanstalk-eu-west-3-{account_id}`) — no hace falta configurarlo.

**Puesta en marcha (paso a paso):**

1. Setear el profile de la cuenta dev y aplicar:
   ```powershell
   $env:AWS_PROFILE = "sigmetum-preprod"
   cd environments/dev
   terraform init
   terraform apply
   ```
2. Copiar el output `ci_role_arn` del apply (ARN del rol IAM).

3. En el repo `sigmetum-backend` → **Settings → Secrets and variables → Actions → Variables** → crear:

   | Variable | Valor |
   |----------|-------|
   | `AWS_ROLE_DEV` | ARN del output `ci_role_arn` (cuenta dev) |

4. Repetir los pasos 1–3 para prod (`sigmetum-prod`, entorno `environments/prod/`, variable `AWS_ROLE_PROD`).

5. Push a `feature/testing` → verificar en GitHub Actions que el job `deploy` pasa.
   - El job `deploy` **no corre en PRs**, solo en push directo a la rama.
   - Si falla por variables no configuradas: re-run desde la pestaña Actions tras crearlas.

## 10. Si cambias algo (en `sigmetum-infra`)

| Si cambias... | Actualiza en este documento | Avisa |
|---|---|---|
| Una clave de `app_env_vars` | Sección 2 | PR: qué clave, en qué entorno (solo nombres) |
| `HealthCheckPath` u otro ajuste de Beanstalk | Sección 3 | PR |
| El ALB, el certificado o el DNS | Sección 4 | PR: nuevo dominio o URL |
| La política IAM de `modules/storage` | Sección 5 (y B2 de la sección 8) | PR: qué acciones o prefijos cambian |
| El listener 80 del ALB o la redirección a HTTPS | Secciones 4 y 5 | PR: efecto en clientes HTTP |
| El tipo de instancia | Sección 6 | PR: motivo (coste o capacidad) |
| `modules/backend-ci-iam` (rol, bucket, permisos) | Sección 9 | PR: qué cambió y si hay que actualizar variables en GitHub |

## 11. Mantener este documento

- Se actualiza cuando cambia `app_env_vars`, el health check, el ALB, el DNS o la política IAM de S3.
- Se contrasta con `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js` del backend antes de afirmar algo sobre su código.
