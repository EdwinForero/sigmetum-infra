# Seguridad del bucket de datos, IAM de instancias, TLS y ALB: plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-seguridad-bucket-iam-tls-design.md`

Crítico: sí. Entradas de `criticidad` que coinciden: IAM y permisos; red y TLS; bucket de datos (versionado, bloqueo, prevent_destroy); destrucción o reemplazo de recursos.

## Revisión del backend (criterio de código 5): llamadores del listado

Solo hay un punto que llama a S3 para listar: `aws/awsS3connect.js:42` (`s3.listObjectsV2` dentro de `listAllObjects`). No hay `ListObjectsV2Command` en código de producción (solo en `tests/` con S3 simulado). `listAllObjects` siempre recibe un `Prefix` con barra final, porque `listFilesInS3Folder` (l.146) y `getPresignedUrlsFromS3Folder` (l.60) lo normalizan.

| Llamador | Prefix enviado | Dentro de `gallery/` o `data/` |
|---|---|---|
| `getPresignedUrlsFromS3Folder` desde `routes/content.js:70` | `gallery/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:63` (`list-files`) | `data/` | Sí |
| `getMergedDataInS3Folder` desde `routes/data.js:93` | `data/active/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:44, 144, 200` | `data/<provincia>/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:53, 184` | `data/drafts/<provincia>/` | Sí |

Claves de lectura, escritura y borrado: todas salen de `s3Paths.js`, `activeVersion.js` y las rutas, y están bajo `gallery/` o `data/`. Excepción: `GET /get-data/:path(*)` (`routes/data.js:84`) pasa `req.params.path` sin acotar a `getObject`; tras el cambio, una clave fuera de esos prefijos dará acceso denegado (efecto deseado). No se toca el backend.

## Fase 1

1. **Política única del bucket: CloudFront solo `assets/*` y Deny TLS**
   - Archivo: `modules/storage/main.tf` (modificar `aws_s3_bucket_policy.cloudfront_oac`; se mantiene el nombre para que el plan sea un update in-place; renombrar exigiría un bloque `moved`).
   - El `jsonencode` pasa a dos sentencias: `AllowCloudFrontOAC` (`s3:GetObject`, `Resource = "${aws_s3_bucket.app.arn}/assets/*"`, misma condición `AWS:SourceArn`) y `DenyInsecureTransport` (`Effect = "Deny"`, `Principal = "*"`, `Action = "s3:*"`; `Resource` el bucket y `/*`; condición `Bool aws:SecureTransport = "false"`).
   - **Decisión del usuario en la puerta del plan:** el Deny usa `s3:*` (patrón estándar de AWS y más fuerte que una lista de acciones) y se refina la regla de `quality-check.mjs` (paso 5) para que solo vigile las sentencias `Allow`. Un `Deny` con `s3:*` y `Principal = "*"` solo restringe; no concede nada. SEG-4 documenta la excepción de `Deny`.
   - Todo va inline en `jsonencode` porque `quality-check.mjs:230` busca el texto `aws:SecureTransport` en el cuerpo del recurso.
   - Compatibilidad con CloudFront: usa el protocolo del visor y `viewer_protocol_policy = "redirect-to-https"` (no cambiarlo), por lo que el Deny no lo rompe.
   - Comprobación: `terraform fmt -check -recursive`, `validate` en dev y prod, `quality-check`. C13b (CloudFront no sirve `gallery/` ni `data/`) por confirmar tras el apply en dev.

2. **Política IAM en línea del rol de instancias, con prefijos y condición de `Prefix`**
   - Archivo: `modules/storage/main.tf` (modificar `aws_iam_role_policy.beanstalk_s3`; `name` y `role` no cambian).
   - Sentencias: `ObjectsInGalleryAndData` (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` sobre `${aws_s3_bucket.app.arn}/gallery/*` y `/data/*`) y `ListGalleryAndData` (`s3:ListBucket` sobre el bucket, `Condition = { StringLike = { "s3:prefix" = ["gallery/*", "data/*"] } }`).
   - El backend siempre envía `Prefix` con barra final; `gallery/*` y `data/*` cubren `gallery/` y `data/`. `data` y `gallery` sin barra, la raíz y un listado sin `Prefix` quedan denegados. No se añaden los literales `data` y `gallery` (ampliarían a `database…`).
   - Sin ARN literales de cuenta y sin `*` en `Action`.
   - Comprobación: `quality-check` en verde; efecto real por confirmar en dev (subida, listado, URL prefirmada y borrado).

3. **`prevent_destroy` y ciclo de vida del bucket**
   - Archivo: `modules/storage/main.tf`: `lifecycle { prevent_destroy = true }` en `aws_s3_bucket.app`, y nuevo `aws_s3_bucket_lifecycle_configuration.app` con `depends_on = [aws_s3_bucket_versioning.app]` y dos reglas con `filter {}`: `expire-noncurrent-versions` (`noncurrent_version_expiration { noncurrent_days = 180 }` y `expiration { expired_object_delete_marker = true }`) y `abort-incomplete-multipart` (`days_after_initiation = 7`).
   - Dos reglas porque cada acción tiene su caso documentado; una sola con tres acciones también valdría (no verificado). Los 7 días de multipart son propuesta por defecto del architect, no de la spec. Las versiones vigentes no caducan.
   - Comprobación: `fmt`, `validate`, `quality-check` (reglas `preventDestroy` y bucket); ver "Qué mirar en el plan".

4. **Redirección 301 del listener 80 en prod (solo con ALB y certificado)**
   - Archivo: `modules/beanstalk/main.tf`: `locals { https_enabled = var.load_balancer_type == "application" && var.ssl_certificate_arn != "" }`; el `for_each` del listener 443 pasa a usar `local.https_enabled`; `data "aws_lb_listener" "http"` (puerto 80, `load_balancer_arn = aws_elastic_beanstalk_environment.this.load_balancers[0]`) y `resource "aws_lb_listener_rule" "http_to_https"` (prioridad 1, `path_pattern /*`, acción `redirect` a `HTTPS`:`443` con `HTTP_301`), ambos con `count = local.https_enabled ? 1 : 0`.
   - Alternativas descartadas: settings de Beanstalk (no admiten redirección), `aws_lb_listener` en el puerto 80 (exigiría `terraform import`, prohibido), `.ebextensions` (repo del backend), desactivar el listener 80 (la spec decide 301).
   - Health check: va del grupo de destino al puerto 80 de la instancia, no pasa por el listener. `dev` (instancia única) da `https_enabled = false` y no cambia.
   - Por confirmar con `plan`/`apply` en prod: que `load_balancers[0]` devuelva el ARN del ALB, y que la regla persista si Beanstalk recrea el listener 80.
   - Comprobación: `fmt`, `validate` en dev y prod, `quality-check`; la prueba real (`curl -I http://<dominio>` da 301) solo tras el apply en prod.

5. **`quality-check.mjs`: retirar las excepciones resueltas de `KNOWN_DEBT` y refinar las reglas 202 y 203 para `Allow`**
   - Archivo: `scripts/quality-check.mjs`.
   - `KNOWN_DEBT` (línea 46 y comentario de la 44): `'modules/storage:app': { tls: 'S5', logging: 'S5', preventDestroy: 'M6' }` pasa a `{ logging: 'S5' }`.
   - Refinamiento (decisión del usuario): las reglas de la línea 202 (`Principal = "*"`) y la 203 (`Action = "s3:*"` o `["*"]`) pasan a aplicarse solo a sentencias con `Effect = "Allow"`; un `Deny` con `Principal = "*"` o `s3:*` no es una concesión y no debe fallar. El cambio es mínimo, sin debilitar la detección en `Allow`: la regla sigue fallando con `Allow` + `Principal = "*"`, con `Allow` + `Action = "s3:*"` y con `Allow` + `Action = ["*"]` (incluida la forma de lista, que hoy no se detecta, según la segunda opinión). El desarrollador comprueba ambos casos con ejemplos y los deja anotados en el resumen; si `quality-check` tiene pruebas propias, se amplían; si no las tiene, se anota como límite.
   - Comprobación: `node scripts/quality-check.mjs` en verde, solo con la nota de S5 `logging`; y un `Allow` con `s3:*` en un `.tf` temporal fuera del repositorio (scratchpad) o en un ejemplo de la propia comprobación sigue fallando.

## A cargo del tester-documentador

- `docs/estado-y-deuda-tecnica.md`: C13 y M6 resueltos en código; S7 resuelto en código con backend:B2 dependiente de infra:S7; S8 resuelto en código con el efecto en prod por confirmar; S5 parcial (TLS resuelto, registros de acceso deuda abierta); métricas con `node scripts/docs-check.mjs --metrics`; "Última actualización" con la fecha de hoy; anotar como hallazgo nuevo los riesgos de "Decisiones y riesgos" si el humano los confirma.
- `docs/referencia-modulos.md`: storage (política de dos sentencias, IAM por prefijos con condición de `Prefix`, `prevent_destroy`, ciclo de vida 180 días y multipart 7 días) y beanstalk (regla de redirección y su condición); sin duplicar cifras.
- `docs/integracion/para-backend.md`: sección 5 y B2 con los prefijos efectivos (`gallery/*`, `data/*`), el listado con `Prefix` con barra y la tabla de llamadores, un prefijo nuevo exige cambiar infra antes, y la nota 403 frente a 404.
- `docs/integracion/para-frontend.md` (línea 86): CloudFront sirve solo `assets/*`; todo recurso público debe vivir ahí.
- `docs/guias/seguridad.md`: SEG-4, SEG-6 y SEG-8 (estado y tabla); aclarar que "nunca `Principal: *`" no aplica a un `Deny` de TLS.
- `docs/guias/buenas-practicas-terraform.md`: BP-8 y BP-9 y tabla de estado.
- `README.md`: `prevent_destroy` bloquea `destroy` en ambos entornos y procedimiento manual de vaciado (borrar versiones y marcadores, quitar temporalmente `prevent_destroy` mediante un cambio revisado, y solo entonces `destroy` con confirmación); la redirección 80 a 443 es solo de prod.
- Aviso de PR `docs/specs/2026-10-30-seguridad-bucket-iam-tls-aviso-pr.md`: tabla de llamadores, qué debe hacer cada repositorio, orden de despliegue, qué mirar en el `plan` y por qué no cambian `app_env_vars`, `VITE_*` ni `build_spec`.

## Pruebas

- Sin pruebas de infraestructura ni de `plugins/` afectadas. Verificación: `terraform fmt -check -recursive`; `terraform init -backend=false && terraform validate` en `environments/dev` y `environments/prod`; `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs`.
- `plan` y `apply` solo los hace el humano.

## Decisiones y riesgos

1. **403 en lugar de 404 con `ListBucket` condicionado (por confirmar, riesgo real).** S3 devuelve 404 `NoSuchKey` solo si quien llama tiene `s3:ListBucket` sin condición que impida evaluarlo; un `GetObject` no lleva `s3:prefix`, así que probablemente devuelva 403 `AccessDenied` para una clave inexistente. `getTextJsonS3` solo trata `NoSuchKey` como lista vacía: si `data/terms/noLatinTerms.json` no existe, la primera alta de término fallaría con 500. **Decisión del usuario en la puerta del plan: el backend tratará `AccessDenied` en esa clave** (cambio en `sigmetum-backend`, fuera de este ciclo: `getTextJsonS3` y los llamadores que hoy solo tratan `NoSuchKey`, y el `errorHandler`; `GET /get-data/<clave inexistente>` pasaría a 403/500 si no se trata). **Consecuencia para el orden de despliegue: el backend se despliega ANTES de que el humano haga el `apply` de infra**, o se crea antes el archivo vacío `data/terms/noLatinTerms.json` (`[]`) como mitigación temporal. Comprobar en dev tras el apply (añadir un término con el archivo ausente y `get-data` de una clave inexistente).
2. **Deny TLS con `s3:*`:** decidido por el usuario (más fuerte que una lista de acciones); la regla de `quality-check.mjs` se refina para `Allow` (paso 5) y SEG-4 documenta la excepción de `Deny`.
3. **Multipart a 7 días:** valor del architect, no de la spec.

## Qué mirar en el `plan` (lo hace el humano; no pegar la salida)

- **Esperado en dev:** `aws_s3_bucket_policy.cloudfront_oac` update in-place; `aws_iam_role_policy.beanstalk_s3` update in-place; `aws_s3_bucket_lifecycle_configuration.app` create.
- **Esperado en prod, además:** `aws_lb_listener_rule.http_to_https[0]` create y la lectura de `aws_lb_listener.http[0]`.
- **No deben aparecer como destroy ni "must be replaced":** `aws_s3_bucket.app` (si aparece como replace, el apply fallará por `prevent_destroy`: parar y revisar `bucket_name`); versionado, cifrado y bloqueo de acceso público del bucket; `aws_cloudfront_distribution.app`, `aws_cloudfront_origin_access_control.app` y `aws_cloudfront_distribution.backend`; `aws_elastic_beanstalk_environment.this`; el rol con `role` cambiado; los módulos `amplify` y `dns`.
- **Antes del apply:** la expiración de versiones es irreversible. Comprobar si ya existe una configuración de ciclo de vida manual en el bucket (por confirmar), porque el apply la sustituye.
- **Orden de despliegue:** no hay despliegue obligatorio en backend ni frontend. 1) Backend y frontend verifican prefijos (backend hecho en este plan; frontend: comprobar que no pide por CloudFront nada fuera de `assets/`, por confirmar). **El backend debe desplegar antes del apply de infra el tratamiento de `AccessDenied`** (decisión del usuario; si no, crear antes el archivo vacío de términos). 2) `plan` revisado y `apply` en dev, con las pruebas del riesgo 1, subida, listado, lectura prefirmada, borrado y `assets/` por CloudFront. 3) `apply` en prod cuando el usuario decida; ahí se prueba la redirección.

## Hallazgos fuera de la spec (sin añadir al alcance)

- `GET /get-data/:path(*)` del backend pasa una ruta arbitraria a `getObject`; conviene validarla con `isValidDataKey` (cambio de backend).
- El nombre `cloudfront_oac` de la política ya no describe su contenido.
- La descripción del output `load_balancers` dice "hostnames", pero en ALB probablemente es el ARN (por confirmar).
- La regla de redirección vive fuera del CloudFormation de Beanstalk: deriva posible si recrea el listener.
- SEG-4 dice "nunca `Principal: *`" sin excepción para `Deny`.

## Cierre

- Documentos de `integracion` afectados: `docs/integracion/para-backend.md` y `docs/integracion/para-frontend.md`.
- Segunda opinión: se pide sobre este plan y sobre el diff.
