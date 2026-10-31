# Aviso para PR: seguridad del bucket de datos, IAM de instancias, TLS y ALB

Fecha: 30/10/2026 · Cambio **crítico** (IAM y permisos; red y TLS; bucket de datos; destrucción o reemplazo de recursos; contrato con el frontend y el backend) · Spec: [design](2026-10-30-seguridad-bucket-iam-tls-design.md) · Plan: [plan](2026-10-30-seguridad-bucket-iam-tls-plan.md)

Integración: `docs/integracion/para-backend.md` y `docs/integracion/para-frontend.md` actualizados. No cambian `app_env_vars`, `VITE_*`, `build_spec`, dominios, región ni el nombre del bucket.

## Qué cambia

- `modules/storage/main.tf`: la política del bucket (`aws_s3_bucket_policy.cloudfront_oac`, mismo nombre, update in-place) pasa a dos sentencias: CloudFront con `s3:GetObject` solo sobre `assets/*`, y `Deny` de TLS (`s3:*`, `Principal = "*"`, `aws:SecureTransport = false`). La política IAM en línea del rol de instancias queda en `GetObject`, `PutObject` y `DeleteObject` sobre `gallery/*` y `data/*`, y `ListBucket` con condición `s3:prefix` (`gallery/*`, `data/*`). `prevent_destroy = true` en el bucket y nueva configuración de ciclo de vida (versiones no actuales a 180 días, marcadores huérfanos, multipart incompleto a 7 días).
- `modules/beanstalk/main.tf`: en `prod` (ALB y certificado), regla de listener que redirige 80 a 443 con 301 sobre el listener 80 de Beanstalk. `dev` no cambia.
- `scripts/quality-check.mjs`: `KNOWN_DEBT` de `modules/storage:app` queda solo con `logging: 'S5'`, y las reglas de `Principal "*"` y `Action` comodín solo vigilan sentencias `Allow` (un `Deny` de TLS no es una concesión).
- Hallazgos: C13, S7, S8 y M6 resueltos en código; S5 parcial (registros de acceso abiertos); nuevos S15, S16 y M12. backend:B2 depende de infra:S7. Efecto aplicado en AWS **(por confirmar)**.

## Revisión de llamadores del listado del backend (criterio de código 5)

Solo hay un punto que lista, `aws/awsS3connect.js:42` (`listAllObjects`); no hay `ListObjectsV2Command` en código de producción. Siempre recibe un `Prefix` con barra final.

| Llamador | Prefix enviado | Dentro de `gallery/` o `data/` |
|---|---|---|
| `getPresignedUrlsFromS3Folder` desde `routes/content.js:70` | `gallery/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:63` (`list-files`) | `data/` | Sí |
| `getMergedDataInS3Folder` desde `routes/data.js:93` | `data/active/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:44, 144, 200` | `data/<provincia>/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:53, 184` | `data/drafts/<provincia>/` | Sí |

Las claves de lectura, escritura y borrado salen de `s3Paths.js`, `activeVersion.js` y las rutas, bajo `gallery/` o `data/`. Excepción: `GET /get-data/:path(*)` pasa `req.params.path` sin acotar; tras el cambio, una clave fuera de esos prefijos dará acceso denegado.

## Backend: qué debe hacer

1. **Tratar `AccessDenied` además de `NoSuchKey`** en `data/terms/noLatinTerms.json` (`getTextJsonS3` en `aws/awsS3connect.js`, usado por `GET /list-terms` y la alta de término) y en `GET /get-data/:path(*)` (decisión del usuario). Verificado hoy en su código: **aún no lo hace** (solo `NoSuchKey` devuelve lista vacía; el `errorHandler` responde 500 salvo `NoSuchKey`). Motivo: con `ListBucket` condicionado por `s3:prefix`, S3 probablemente responda 403 y no 404 para una clave inexistente **(por confirmar en dev)**.
2. **Desplegar esto ANTES del `apply` de infra.** Mitigación temporal si no puede ser, con el perfil de cada cuenta (dev y prod):
   ```bash
   echo '[]' > noLatinTerms.json
   aws s3 cp noLatinTerms.json s3://<bucket>/data/terms/noLatinTerms.json --profile <perfil-de-la-cuenta>
   ```
   No cubre `GET /get-data/<clave inexistente>`.
3. Recomendado (fuera de este ciclo): validar la clave de `GET /get-data/:path(*)` con `isValidDataKey`.
4. Todo listado nuevo debe llevar `Prefix` con barra final dentro de `gallery/` o `data/`; un prefijo nuevo exige cambiar infra antes.
5. Actualizar B2 en su documentación: resuelto en código, dependiente de infra:S7.

## Frontend: qué debe hacer

1. Comprobar que no pide por CloudFront (`VITE_S3_URL`) nada fuera de `assets/` **(por confirmar)**: galería y datos ya no se sirven por ahí.
2. Todo recurso público nuevo debe vivir bajo `assets/`. Sin cambios en `VITE_*` ni `build_spec`.
3. Recordatorio: C7 (nada sube `assets/` al bucket) sigue abierto.

## Orden de despliegue

1. **Backend**: desplegar el tratamiento de `AccessDenied` (o subir antes el `noLatinTerms.json` vacío a dev y prod).
2. Frontend: verificar sus rutas (sin despliegue).
3. Humano, `dev`: comprobar antes si el bucket ya tiene un ciclo de vida manual (el `apply` lo sustituye); revisar el `plan`; `apply`. Probar: subida, listado, URL prefirmada, borrado, alta de término con el archivo ausente, `GET /get-data/<clave inexistente>`, `assets/` por CloudFront y que `gallery/` o `data/` por CloudFront no devuelven el objeto (C13b).
4. Humano, `prod`, más adelante (el usuario aún no despliega prod; el certificado ya existe): mismo `plan` y `apply`; después `curl -I http://<dominio>` debe dar 301.

## Qué mirar en el `plan` (lo hace el humano; no pegar la salida)

- **Esperado en dev:** `aws_s3_bucket_policy.cloudfront_oac` update in-place; `aws_iam_role_policy.beanstalk_s3` update in-place; `aws_s3_bucket_lifecycle_configuration.app` create.
- **Esperado en prod, además:** `aws_lb_listener_rule.http_to_https[0]` create y lectura de `aws_lb_listener.http[0]`.
- **No deben aparecer como destroy ni "must be replaced":** `aws_s3_bucket.app` (si aparece como replace, el `apply` fallará por `prevent_destroy`: parar y revisar `bucket_name`), versionado, cifrado y bloqueo de acceso público, `aws_cloudfront_distribution.app` y `.backend`, `aws_cloudfront_origin_access_control.app`, `aws_elastic_beanstalk_environment.this`, el rol y los módulos `amplify` y `dns`.

## Riesgos

- La redirección 301 afecta a **todo** cliente HTTP (no solo navegadores) y vive fuera del CloudFormation de Beanstalk: se pierde en silencio si Beanstalk recrea el listener 80.
- El `apply` sustituye cualquier ciclo de vida manual del bucket y la expiración de versiones (180 días) es irreversible: comprobar antes si hay uno.
- `prevent_destroy` bloquea `destroy` en ambos entornos; el vaciado manual está en el README.
- `load_balancers[0]` como ARN del ALB **(por confirmar)** con `plan`/`apply` en prod.
- 403 frente a 404 en claves inexistentes **(por confirmar)**: ver la tarea 1 del backend.
- El Deny de TLS usa `s3:*` y `Principal = "*"`: solo restringe; la regla de `quality-check` solo vigila sentencias `Allow` (excepción documentada en SEG-4).

## Fuera de alcance (deuda o aviso, sin ampliar el alcance)

- Validar `isValidDataKey` en `GET /get-data/:path(*)` (backend).
- El nombre `cloudfront_oac` de la política ya no describe su contenido (renombrar exige `moved`).
- La descripción del output `load_balancers` dice "Balanceadores" y en un ALB probablemente es el ARN **(por confirmar)**.
- Registros de acceso del bucket (S5 abierto, sin bucket de logs nuevo). Registrados en M12 y S5 de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md).

## Por confirmar

- Contenido real de las políticas, ciclo de vida y listener aplicados en AWS (no se ha ejecutado `plan` ni `apply`).
- Que `prod` se comporte igual que `dev` en bucket e IAM (mismo módulo; expectativa, no hecho).
- Diagramas que describen flujos que cambiaron: `docs/diagramas/arquitectura-dev.html` y `docs/diagramas/arquitectura-prod.html` (acceso de CloudFront al bucket y, en prod, el listener 80); no se regeneran en este ciclo.
