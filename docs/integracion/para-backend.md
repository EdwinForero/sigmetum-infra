# Integración con el backend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-backend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios). El backend no tiene un documento `para-infra.md` equivalente: su contrato con esta infraestructura es `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js`, que se citan aquí.

- Lo verificado contra el código de Terraform y del backend está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 30/10/2026). Infraestructura: rama `feature/testing`, commit base `d3866f5` (cambios sin commitear). Backend: rama `feature/sigmetum_v2`, commit `ea19315`.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| ~~**infra:C5**~~ | ~~`app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`~~ | ~~El backend no arranca~~ | **Resuelto** — plantillas `.example` y referencia incluyen todas las obligatorias **(verificado)** |
| ~~**infra:C6**~~ | ~~`HealthCheckPath` de Beanstalk es `/`~~ | ~~El entorno puede figurar como no saludable~~ | **Resuelto** (`feature/testing` de infra): `HealthCheckPath = "/healthcheck"` **(verificado)** |
| ~~**backend:B1**~~ | ~~El backend no configuraba `trust proxy`~~ | ~~IP del balanceador compartida por todos los usuarios en el rate-limiter~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', ...)` en `app.js`, con los saltos fijados por `TRUST_PROXY_HOPS` (1 si no se define) **(verificado)** |
| **backend:I7** | `TRUST_PROXY_HOPS` no está en `app_env_vars`: el backend usa 1 salto por defecto | Si los saltos reales difieren, el limitador de intentos agrupa mal las IP o se esquiva con `X-Forwarded-For` | **Abierto (prioridad alta)**: infra mide los saltos y la fija en `app_env_vars` **antes de que el backend despliegue la entrega 2 de M21** (`POST /send-email` pública; condición del backend en su `para-infra.md`, sección 6) (no es `frontend:I7`) |

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

### Cabeceras `X-Forwarded-*` y `trust proxy`

El ALB de prod (y CloudFront en dev) añaden `X-Forwarded-For` y `X-Forwarded-Proto` a las peticiones. El backend configura `app.set('trust proxy', ...)` en `app.js` **(B1 resuelto, 03/10/2026)** con el número de saltos de `TRUST_PROXY_HOPS` (opcional; 1 si no se define; entero de 1 a 5, el 0 solo con `NODE_ENV` `local` o `test`, `config/trustProxy.js`, verificado): Express y el limitador de `express-rate-limit` leen la IP real del cliente. Infra no fija hoy la variable y el recuento real de saltos de cada entorno no está medido: `backend:I7` abierto (**por confirmar**).

## 5. Permisos IAM de S3

La política que `modules/storage` añade al rol `aws-elasticbeanstalk-ec2-role` da `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` y `s3:ListBucket` sobre el bucket completo y sus objetos (`modules/storage/main.tf`, verificado).

`aws/awsS3connect.js` del backend usa `GetObjectCommand`, `PutObjectCommand` (vía `s3.putObject`), `DeleteObjectCommand` (vía `s3.deleteObject`) y `ListObjectsV2Command` (verificado): las cuatro acciones que concede la política. No usa ninguna acción adicional (sin `PutObjectAcl`, sin operaciones multipart).

**No es mínimo privilegio a nivel de prefijo:** el rol puede escribir y borrar en cualquier ruta del bucket, incluida `assets/…` (recursos públicos del frontend), aunque el backend solo opera sobre `gallery/`, `data/`, `data/active/`, `data/terms/` y `data/drafts/` (`config/s3Paths.js`, verificado). La política cubre todo el bucket, así que estos prefijos no exigen **ningún cambio de permisos**. Ver [S7](../estado-y-deuda-tecnica.md#abiertos).

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
| `prod` | El dominio del frontend en `prod`, que hoy no existe (infra:C9) | Por fijar tras crear el dominio |

Ver [para-frontend.md](para-frontend.md#4-orden-de-despliegue): `ALLOWED_ORIGIN` depende de una URL que solo se conoce después de desplegar Amplify.

## 8. Discrepancias

| Id | Qué pasa | Dónde | Responsable | Qué hacer |
|---|---|---|---|---|
| **B1** | ~~Sin `trust proxy`, el límite de intentos de login puede agruparse por la IP del balanceador~~ | `../sigmetum-backend/app.js` | backend | **Resuelto (04/10/2026):** `trust proxy` añadido en commit `7748a1c`; hoy en `app.js`, con `TRUST_PROXY_HOPS` |
| **backend:I7** | `TRUST_PROXY_HOPS` sin fijar en `app_env_vars` (1 salto por defecto) | `modules/beanstalk/main.tf` | infra y backend | Infra mide los saltos de cada entorno y fija la variable. **Condición del backend:** es obligatorio **antes de desplegar la entrega 2 de M21** (`POST /send-email` pública); origen: `sigmetum-backend/docs/integracion/para-infra.md`, sección 6 (límite de `POST /send-email`) y fila I7 de la tabla de discrepancias. El backend no cambia código, pero no debe desplegar esa entrega hasta que infra lo confirme |
| **B2** | La política IAM de S3 da escritura y borrado sobre todo el bucket, más permiso del que usa el código | `modules/storage/main.tf` | infra | Limitar a los prefijos de `config/s3Paths.js` (también registrado como [S7](../estado-y-deuda-tecnica.md#abiertos)) |
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
| La política IAM de `modules/storage` | Sección 5 | PR: qué acciones o prefijos cambian |
| El tipo de instancia | Sección 6 | PR: motivo (coste o capacidad) |
| `modules/backend-ci-iam` (rol, bucket, permisos) | Sección 9 | PR: qué cambió y si hay que actualizar variables en GitHub |

## 11. Mantener este documento

- Se actualiza cuando cambia `app_env_vars`, el health check, el ALB, el DNS o la política IAM de S3.
- Se contrasta con `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js` del backend antes de afirmar algo sobre su código.
