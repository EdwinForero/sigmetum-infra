# Integración con el backend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-backend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios). El backend no tiene un documento `para-infra.md` equivalente: su contrato con esta infraestructura es `config/validateEnv.js`, `index.js` y `aws/awsS3connect.js`, que se citan aquí.

- Lo verificado contra el código de Terraform y del backend está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/09/2026. Infraestructura: rama `feature/testing` (cambios sin confirmar). Backend: commit `ace5367`.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| **infra:C5** | `app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD` en el `terraform.tfvars` de dev (obligatorias en `validateEnv.js`) | El backend no arranca | Abierto |
| **infra:C6** | `HealthCheckPath` de Beanstalk es `/`; el backend responde en `/healthcheck` | El entorno puede figurar como no saludable | Abierto |
| **backend:B1** | `index.js` no configura `trust proxy`; el límite de intentos de login es por IP | Detrás del ALB, todos los usuarios pueden compartir la misma IP vista por `express-rate-limit` | Abierto (por confirmar el efecto real) |

## 2. Contrato de entorno: `app_env_vars` frente a `validateEnv.js`

El backend exige estas variables al arrancar (`config/validateEnv.js`, verificado). Solo se listan **nombres**, nunca valores:

| Variable | Exigida por el backend | La define `app_env_vars` hoy | Es secreto |
|---|---|---|---|
| `JWT_SECRET` | Sí | Sí | Sí |
| `JWT_EXPIRATION` | Sí | Sí | No |
| `ADMIN_USERNAME` | Sí | **No** (infra:C5) | No |
| `ADMIN_PASSWORD` | Sí | **No** (infra:C5) | Sí (hash bcrypt) |
| `EMAIL` | Sí | Sí | No |
| `EMAIL_PASSWORD` | Sí | Sí | Sí |
| `AWS_REGION` | Sí | Sí | No |
| `AWS_BUCKET_NAME` | Sí | Sí | No |
| `ALLOWED_ORIGIN` | Sí | **No** (infra:C5) | No |
| `AWS_PROFILE` | Solo si `NODE_ENV=local` | No aplica (Beanstalk no usa `NODE_ENV=local`) | No |

Las plantillas `environments/*/terraform.tfvars.example` de este repositorio ya incluyen las tres claves que faltaban; falta aplicarlas a los `terraform.tfvars` reales (fuera de este repositorio, no se han leído).

**Cómo llegan hoy:** como propiedades de entorno del entorno de Beanstalk (`dynamic "setting"` sobre `app_env_vars`, namespace `aws:elasticbeanstalk:application:environment`, verificado en `modules/beanstalk/main.tf`). Son legibles en la consola por quien pueda ver la configuración del entorno (hallazgo de seguridad [S6](../estado-y-deuda-tecnica.md#abiertos)).

## 3. Health check

- Beanstalk comprueba `HealthCheckPath = "/"` (`modules/beanstalk/main.tf`, verificado).
- El backend responde `200 ok` en `/healthcheck`; no define ninguna ruta en `/`, así que Express devuelve 404 (`index.js`, verificado).
- Efecto en el estado del entorno: **(por confirmar)**.

## 4. HTTPS, ALB y DNS

| Entorno | HTTPS | Balanceador | DNS |
|---|---|---|---|
| `dev` | No (instancia única) | Ninguno | Ninguno |
| `prod` | Sí, si `ssl_certificate_arn` está definido | ALB (autoescalado 1–3) | `backend.sigmetum-a.org` (CNAME al endpoint de Beanstalk, `modules/dns`) |

**(verificado en `environments/*/main.tf` y `modules/dns/main.tf`).**

### Cabeceras `X-Forwarded-*` y `trust proxy`

El ALB de prod añade `X-Forwarded-For` y `X-Forwarded-Proto` a las peticiones (comportamiento estándar de un ALB de AWS, **por confirmar** en este despliegue). El backend no llama a `app.set('trust proxy', ...)` en `index.js` (verificado): sin eso, Express (y el limitador de `express-rate-limit` en `routes/auth.js`) ve la IP del balanceador, no la del cliente, y el límite de intentos de login se aplicaría a todos los usuarios juntos (backend:B1). Es una decisión del código del backend; infra solo puede confirmar que el ALB reenvía esas cabeceras.

## 5. Permisos IAM de S3

La política que `modules/storage` añade al rol `aws-elasticbeanstalk-ec2-role` da `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` y `s3:ListBucket` sobre el bucket completo y sus objetos (`modules/storage/main.tf`, verificado).

`aws/awsS3connect.js` del backend usa `GetObjectCommand`, `PutObjectCommand` (vía `s3.putObject`), `DeleteObjectCommand` (vía `s3.deleteObject`) y `ListObjectsV2Command` (verificado): las cuatro acciones que concede la política. No usa ninguna acción adicional (sin `PutObjectAcl`, sin operaciones multipart).

**No es mínimo privilegio a nivel de prefijo:** el rol puede escribir y borrar en cualquier ruta del bucket, incluida `assets/…` (recursos públicos del frontend), aunque el backend solo opera sobre `gallery/`, `data/` y `data/active/` (`config/s3Paths.js`, verificado). Ver [S7](../estado-y-deuda-tecnica.md#abiertos).

## 6. Plataforma, tamaño de instancia y correo saliente

- **Plataforma:** `64bit Amazon Linux 2023 v6.4.0 running Node.js 20` (`modules/beanstalk/variables.tf`, verificado). El `package.json` del backend no fija `engines.node` (verificado); coincide con la plataforma mientras no se cambie ninguno de los dos.
- **Tamaño de instancia:** `t3.nano` en ambos entornos (verificado). El backend procesa ficheros Excel en memoria (`convertExcelToJson`, en `aws/awsS3connect.js` y otros); no hay una cifra de tamaño máximo de fichero ni una medición de uso de memoria con `t3.nano` (**por confirmar**; si los Excel crecen, puede haber que subir el tipo de instancia).
- **Correo saliente:** el backend usa `nodemailer` contra `smtp.gmail.com` (`routes/content.js`, verificado) con `EMAIL`/`EMAIL_PASSWORD`. Sale por el puerto SMTP habitual (587/465); el grupo de seguridad de salida de Beanstalk no está restringido en este repositorio (egress por defecto), así que no debería bloquearlo (**por confirmar** en la cuenta real).
- **Despliegue:** manual, subiendo un `.zip` del código por la consola o CLI de Beanstalk (README, verificado). No hay integración continua que empaquete y despliegue el backend.

## 7. `ALLOWED_ORIGIN` por entorno

El backend usa CORS con **un único origen exacto** (`cors({ origin: process.env.ALLOWED_ORIGIN })`, `index.js`, verificado). Debe ser el dominio del frontend de ese mismo entorno:

| Entorno | Origen que debería llevar `ALLOWED_ORIGIN` | Estado |
|---|---|---|
| `dev` | La URL real de la rama `feature/testing` en Amplify (el output `branch_url` puede no coincidir, infra:C8) | Por fijar tras corregir infra:C8 |
| `prod` | El dominio del frontend en `prod`, que hoy no existe (infra:C9) | Por fijar tras crear el dominio |

Ver [para-frontend.md](para-frontend.md#4-orden-de-despliegue): `ALLOWED_ORIGIN` depende de una URL que solo se conoce después de desplegar Amplify.

## 8. Discrepancias

| Id | Qué pasa | Dónde | Responsable | Qué hacer |
|---|---|---|---|---|
| **B1** | Sin `trust proxy`, el límite de intentos de login puede agruparse por la IP del balanceador | `../sigmetum-backend/index.js` | backend | Confirmar el efecto real tras el ALB y, si aplica, añadir `app.set('trust proxy', 1)` |
| **B2** | La política IAM de S3 da escritura y borrado sobre todo el bucket, más permiso del que usa el código | `modules/storage/main.tf` | infra | Limitar a los prefijos de `config/s3Paths.js` (también registrado como [S7](../estado-y-deuda-tecnica.md#abiertos)) |
| **B3** | `package.json` del backend no fija `engines.node`; si alguien lo ejecuta con otra versión de Node, nada lo avisa | `../sigmetum-backend/package.json` | backend | Añadir `"engines": { "node": "20.x" }` |

## 9. Si cambias algo (en `sigmetum-infra`)

| Si cambias... | Actualiza en este documento | Avisa |
|---|---|---|
| Una clave de `app_env_vars` | Sección 2 | PR: qué clave, en qué entorno (solo nombres) |
| `HealthCheckPath` u otro ajuste de Beanstalk | Sección 3 | PR |
| El ALB, el certificado o el DNS | Sección 4 | PR: nuevo dominio o URL |
| La política IAM de `modules/storage` | Sección 5 | PR: qué acciones o prefijos cambian |
| El tipo de instancia | Sección 6 | PR: motivo (coste o capacidad) |

## 10. Mantener este documento

- Se actualiza cuando cambia `app_env_vars`, el health check, el ALB, el DNS o la política IAM de S3.
- Se contrasta con `config/validateEnv.js`, `index.js` y `aws/awsS3connect.js` del backend antes de afirmar algo sobre su código.
