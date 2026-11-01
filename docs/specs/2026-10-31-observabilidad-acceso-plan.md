# Registros de acceso de S3 (D1): plan

Fecha: 2026-10-31 · Estado: cerrado · Spec: `docs/specs/2026-10-31-observabilidad-acceso-design.md`

Crítico: sí. Coincide con «bucket de datos (versionado, bloqueo, prevent_destroy)» (se añade un recurso al bucket de datos y un bucket nuevo con las mismas protecciones), con «red y TLS» (política con `Deny` de `aws:SecureTransport` y política de entrega con principal de servicio) y, de forma secundaria, con «destrucción o reemplazo de recursos» (hay que confirmar en el `plan` que no hay replace, y el bucket de logs lleva `prevent_destroy`).

## Decisiones (alternativas descartadas)

**D-1. Dónde vive el bucket de logs:** en `modules/storage`, con `aws_s3_bucket.access_logs` junto al de datos. Se descarta `modules/logging`: su política necesita el ARN del bucket de datos (salida de `storage`) y `storage` necesita el nombre del bucket de logs, lo que es un ciclo que solo se evita construyendo ARN a mano en `environments/*`, y BP-1 dice que los entornos no definen recursos ni lógica. Se descarta `modules/backend-ci-iam`: trata de IAM de CI y no declara ningún bucket. Con `storage` no hay ciclo: `backend-ci-iam` consume un output de `storage` desde `environments/*/main.tf` y `storage` no consume nada de `backend-ci-iam`. Coste: `storage` conoce el nombre derivado del bucket de staging (`elasticbeanstalk-<región>-<cuenta>`), escrito en dos sitios (`storage` y `backend-ci-iam`); una duplicación de una línea que no se elimina porque exigiría otro módulo.

**D-2. Nombre:** `sigmetum-access-logs-${var.environment}`, que sigue el patrón de los buckets de estado y no lleva identificador de cuenta; sin variable nueva en `storage`. Los nombres de bucket son globales: si estuviera tomado, el `apply` fallaría (por confirmar).

**D-3. Versiones no actuales:** siete días. Los logs se escriben una vez y nunca se sobrescriben; las únicas versiones no actuales son las que crea la expiración de los noventa días (basura). Retención total aproximada: noventa y siete días. Se descarta igualar al bucket de datos (ciento ochenta días): duplicaría el coste sin utilidad.

**D-4. Prefijos de entrega:** `app-data/` para el bucket de datos y `beanstalk-staging/` para el de staging; la política de entrega limita `s3:PutObject` a esos dos prefijos.

**D-5. Regla `logging` de `quality-check`:** `related()` asocia al bucket cualquier `aws_s3_bucket_logging` del mismo directorio cuyo cuerpo contenga `aws_s3_bucket.access_logs.`. Si `aws_s3_bucket_logging.app` usara `aws_s3_bucket.access_logs.id` directamente, la regla daría por bueno el logging del bucket de logs y la excepción M15 quedaría inútil y engañosa. El logging del bucket de datos usa `local.access_logs_bucket` (definido como `aws_s3_bucket.access_logs.id`) y el `depends_on` va contra la política (`aws_s3_bucket_policy.access_logs`), que no contiene esa cadena.

## Fase 1

1. **Bucket de logs, logging del bucket de datos y output, en `modules/storage`**
   - Archivos: `modules/storage/main.tf` y `modules/storage/outputs.tf` (modificar). `variables.tf` no cambia.
   - Al principio de `main.tf`:
     ```hcl
     data "aws_caller_identity" "current" {}
     data "aws_region" "current" {}

     locals {
       account_id         = data.aws_caller_identity.current.account_id
       staging_bucket_arn = "arn:aws:s3:::elasticbeanstalk-${data.aws_region.current.name}-${local.account_id}"
       access_logs_bucket = aws_s3_bucket.access_logs.id
     }
     ```
   - Recursos nuevos, bajo un comentario `# ── Access logs bucket ──`, todos con `bucket = aws_s3_bucket.access_logs.id` salvo la política y el logging:
     ```hcl
     resource "aws_s3_bucket" "access_logs" {
       bucket = "sigmetum-access-logs-${var.environment}"
       tags   = { Component = "storage" }
       lifecycle { prevent_destroy = true }
     }

     resource "aws_s3_bucket_public_access_block" "access_logs" {
       bucket                  = aws_s3_bucket.access_logs.id
       block_public_acls       = true
       block_public_policy     = true
       ignore_public_acls      = true
       restrict_public_buckets = true
     }

     resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
       bucket = aws_s3_bucket.access_logs.id
       rule {
         apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
       }
     }

     resource "aws_s3_bucket_versioning" "access_logs" {
       bucket = aws_s3_bucket.access_logs.id
       versioning_configuration { status = "Enabled" }
     }

     resource "aws_s3_bucket_ownership_controls" "access_logs" {
       bucket = aws_s3_bucket.access_logs.id
       rule { object_ownership = "BucketOwnerEnforced" }
     }

     resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
       bucket = aws_s3_bucket.access_logs.id

       rule {
         id     = "expire-logs"
         status = "Enabled"
         filter {}
         expiration { days = 90 }
         noncurrent_version_expiration { noncurrent_days = 7 }
       }
       rule {
         id     = "expire-orphan-delete-markers"
         status = "Enabled"
         filter {}
         expiration { expired_object_delete_marker = true }
       }
       rule {
         id     = "abort-incomplete-multipart"
         status = "Enabled"
         filter {}
         abort_incomplete_multipart_upload { days_after_initiation = 7 }
       }
       depends_on = [aws_s3_bucket_versioning.access_logs]
     }
     ```
     `expiration { days }` y `expired_object_delete_marker` no pueden ir en el mismo bloque `expiration`; por eso son dos reglas.
   - Política única del bucket de logs:
     ```hcl
     resource "aws_s3_bucket_policy" "access_logs" {
       bucket = aws_s3_bucket.access_logs.id
       policy = jsonencode({
         Version = "2012-10-17"
         Statement = [
           {
             Sid       = "S3ServerAccessLogsDelivery"
             Effect    = "Allow"
             Principal = { Service = "logging.s3.amazonaws.com" }
             Action    = "s3:PutObject"
             Resource = [
               "${aws_s3_bucket.access_logs.arn}/app-data/*",
               "${aws_s3_bucket.access_logs.arn}/beanstalk-staging/*"
             ]
             Condition = {
               ArnLike      = { "aws:SourceArn" = [aws_s3_bucket.app.arn, local.staging_bucket_arn] }
               StringEquals = { "aws:SourceAccount" = local.account_id }
             }
           },
           {
             Sid       = "DenyInsecureTransport"
             Effect    = "Deny"
             Principal = "*"
             Action    = "s3:*"
             Resource  = [aws_s3_bucket.access_logs.arn, "${aws_s3_bucket.access_logs.arn}/*"]
             Condition = { Bool = { "aws:SecureTransport" = "false" } }
           }
         ]
       })
       depends_on = [
         aws_s3_bucket_public_access_block.access_logs,
         aws_s3_bucket_ownership_controls.access_logs,
         aws_s3_bucket_server_side_encryption_configuration.access_logs,
         aws_s3_bucket_versioning.access_logs,
       ]
     }
     ```
     El `depends_on` contra el bloqueo evita el error de política pública; los otros evitan que S3 reciba en paralelo varias escrituras sobre el mismo bucket (error conocido `OperationAborted`, conflicto 409).
   - Logging del bucket de datos:
     ```hcl
     resource "aws_s3_bucket_logging" "app" {
       bucket        = aws_s3_bucket.app.id
       target_bucket = local.access_logs_bucket
       target_prefix = "app-data/"
       depends_on    = [aws_s3_bucket_policy.access_logs]
     }
     ```
   - `outputs.tf` gana un output `access_logs_bucket_name` con `value = aws_s3_bucket_policy.access_logs.bucket` (así el consumidor depende de la política de entrega y Terraform crea el logging de `backend-ci-iam` después de ella; el atributo `bucket` de `aws_s3_bucket_policy` es el nombre del bucket) y una descripción en inglés.
   - Firmas que cambian: ninguna variable; un output nuevo en `storage`; la política del bucket de datos (`aws_s3_bucket_policy.cloudfront_oac`) no se toca.
   - `quality-check` no marca la `Allow` de la política de logs (`Principal` es un mapa de servicio, no `"*"`, y la acción es `s3:PutObject`); su `Deny` se elimina antes de buscar comodines, igual que el del bucket de datos.
   - Comprobación: `terraform fmt -check -recursive`; `terraform validate` en `environments/dev` y `environments/prod`; después `node scripts/quality-check.mjs` (solo debe mostrar el aviso de deuda conocida M15, que se verá tras el paso 4).
   - Efecto en el `plan` (lo revisa el humano): `aws_s3_bucket_logging.app` es un recurso aparte, no cambia atributos del `aws_s3_bucket.app` y no fuerza recreación; solo creaciones.
   - Norma: `seguridad.md` SEG-6; `buenas-practicas-terraform.md` BP-8 (`prevent_destroy`) y BP-9 (ciclo de vida de versiones); BP-1 (ver D-1).

2. **Logging del bucket de staging de Beanstalk, en `modules/backend-ci-iam`**
   - Archivos: `modules/backend-ci-iam/variables.tf` y `modules/backend-ci-iam/main.tf` (modificar). `outputs.tf` no cambia.
   - Variable nueva, obligatoria y sin valor por defecto:
     ```hcl
     variable "access_logs_bucket_name" {
       description = "Name of the S3 bucket that receives the access logs of the Beanstalk staging bucket."
       type        = string
     }
     ```
   - En `main.tf`, tras los locals (no se declara ningún `aws_s3_bucket`):
     ```hcl
     # ── Access logs of the Beanstalk staging bucket ──
     # The bucket is created by Beanstalk, not by Terraform: only its logging setting is managed here.
     resource "aws_s3_bucket_logging" "eb_staging" {
       bucket        = "elasticbeanstalk-${var.aws_region}-${local.account_id}"
       target_bucket = var.access_logs_bucket_name
       target_prefix = "beanstalk-staging/"
     }
     ```
   - Permisos del rol de CI: no cambian (el `apply` del humano, con sus propias credenciales, hace `PutBucketLogging`).
   - Comprobación: `terraform validate` en `dev` y `prod` (tras el paso 3). `quality-check` no inspecciona este recurso porque no hay `aws_s3_bucket`.
   - Efecto de gestionar el bucket de staging: no hace falta `import` (es un `PutBucketLogging` contra un bucket existente); se sobrescribe cualquier configuración de logs que tuviera y un cambio manual posterior aparecerá como deriva; si el bucket no existe (cuenta nueva sin primer despliegue de Beanstalk), el `apply` falla con `NoSuchBucket` (hay que desplegar Beanstalk primero, o aplicar con `-target` por decisión humana); si Terraform no puede escribir en ese bucket por una política ajena, fallaría (por confirmar). Sin `depends_on` explícito hacia la política del bucket de logs (está en otro módulo): el orden lo da el valor `access_logs_bucket_name`, que sale de `aws_s3_bucket_policy.access_logs`, de modo que Terraform crea la política antes que este logging. Importa porque S3 valida en `PutBucketLogging` que el destino admita la entrega (error `InvalidTargetBucketForLogging`; por confirmar con la documentación actual). Además, la identidad que hace el `apply` necesita `s3:PutBucketLogging` sobre el bucket de staging, y un `destroy` futuro de este recurso desactivaría los logs de un bucket que Terraform no posee.
   - Norma: `seguridad.md` SEG-6.

3. **Conectar los dos módulos en los entornos**
   - Archivos: `environments/dev/main.tf` y `environments/prod/main.tf` (modificar). En el módulo `backend_ci_iam` de cada entorno se añade `access_logs_bucket_name = module.storage.access_logs_bucket_name`, igual en ambos (BP-1: entornos alineados, sin diferencias). Sin variables ni outputs de entorno nuevos.
   - Comprobación: `terraform validate` en `dev` y `prod`; `terraform fmt -check -recursive`.

4. **`scripts/quality-check.mjs`: solo datos de `KNOWN_DEBT.buckets`**
   - Archivo: `scripts/quality-check.mjs` (modificar, líneas 42 a 47). El comentario de la línea 42 pasa a decir que solo queda el bucket de logs, sin registros de acceso (M15). El objeto queda:
     ```js
     buckets: {
       // el bucket de logs no se registra a sí mismo (evita el bucle de logs sobre logs): M15
       'modules/storage:access_logs': { logging: 'M15' },
     },
     ```
   - Se retiran `modules/storage:app` (S5) y `modules/backend-ci-iam:deploys` (con su comentario TLS). El script identifica los buckets con la clave `dir:label`. Una entrada de `KNOWN_DEBT.buckets` para un bucket que ya no existe se ignora (solo se consulta al recorrer los `aws_s3_bucket` existentes): por eso `deploys` no fallaba y retirarla es limpieza. La lógica y las pruebas del script no cambian.
   - Comprobación: `node scripts/quality-check.mjs` debe pasar y mostrar `modules/storage:access_logs sin registros de acceso: deuda conocida M15`; sin esa entrada fallaría. Ese aviso prueba que la excepción es real (D-5).
   - Norma: `mantenimiento.md` (una excepción nueva solo entra con su hallazgo registrado; M15 lo registra el tester-documentador en el mismo cambio).

## A cargo del tester-documentador

1. `docs/estado-y-deuda-tecnica.md`: fecha de «Última actualización» según el reloj del sistema; S5, parte «registros de acceso», resuelta en código (efecto en AWS por confirmar hasta el `apply` y la aparición de logs); M11 resuelto en código con la salvedad de que en una cuenta nueva el `apply` falla hasta que Beanstalk cree el bucket de staging; hallazgo nuevo M15 (Baja): el bucket de logs no se registra a sí mismo, excepción aceptada en `KNOWN_DEBT`; anotar que la entrada obsoleta `modules/backend-ci-iam:deploys` se retiró (su id M9 era de otro hallazgo); actualizar el recuento de recursos declarados y de outputs con `node scripts/docs-check.mjs --metrics` (esperado: ocho recursos nuevos en `storage` —bucket, bloqueo, cifrado, versionado, propiedad, ciclo de vida, política y el logging del bucket de datos— y uno en `backend-ci-iam`, es decir nueve más, y un output más; ojo: son ocho en `storage` (bucket, bloqueo, cifrado, versionado, propiedad, ciclo de vida, política y el logging del bucket de datos) y uno en `backend-ci-iam`; verificar con el comando, no con esta cuenta); las cifras, con letras en el texto.
2. `docs/referencia-modulos.md`: `storage`: los recursos nuevos y el output `access_logs_bucket_name`; `backend-ci-iam`: la variable `access_logs_bucket_name` (obligatoria, columna «Por defecto» con `—`) y el recurso `aws_s3_bucket_logging.eb_staging`.
3. `docs/guias/seguridad.md`: SEG-6 y su tabla alineados con el código (registros de acceso en el bucket de datos y en el de staging, bucket de logs con TLS, retención de noventa días, IP de visitantes en los logs). Comprobar a qué guía corresponde cada SEG antes de editar.
4. `docs/guias/buenas-practicas-terraform.md`: opcional; BP-8 (el bucket de logs lleva `prevent_destroy`) y BP-9 (coste: versiones no actuales de siete días) solo si la tabla o el texto lo piden.
5. `README.md`: el bucket de logs por entorno, sus noventa días de retención, que `dev` y `prod` tienen uno cada uno (misma estructura, solo cambia el nombre; no hay divergencia). `docs/iam-role-setup.md`: sin cambio de permisos, pero lo exige `docsPorArea` para `modules/backend-ci-iam/**`; basta un párrafo breve sobre la variable nueva.
6. Aviso de PR `docs/specs/2026-10-31-observabilidad-acceso-aviso-pr.md` (`docs-gate` lo exige porque se tocan `modules/storage/**` y `environments/**/main.tf`, áreas de contrato). Debe contener una línea que empiece exactamente por `Integración: sin impacto — ` seguida del motivo (sin eso `docs-gate` falla, aunque los dos documentos de integración no cambien). Contenido: orden de despliegue (Terraform en `dev`, comprobar logs, luego `prod`; backend y frontend no hacen nada), lo que revisa el humano en el `plan` y la verificación posterior (por confirmar).

## Qué debe mirar el humano en el `plan`

1. Solo creaciones: los recursos del bucket de logs y los dos `aws_s3_bucket_logging`. Ningún destroy ni replace, y `aws_s3_bucket.app` y su política `cloudfront_oac` sin cambios.
2. `aws_s3_bucket_logging.eb_staging` se crea sobre un bucket que Terraform no gestiona.
3. Que el nombre `sigmetum-access-logs-<env>` no choque con uno existente.
4. Después del `apply`: pasadas unas horas deben aparecer objetos en `app-data/` y en `beanstalk-staging/` del bucket de logs (por confirmar).
5. Orden: `dev` primero, comprobar logs, luego `prod`. Frontend y backend: ninguna acción.

## Riesgos

1. Cuenta nueva sin bucket de staging: el `apply` del paso 2 falla (`NoSuchBucket`) hasta el primer despliegue de Beanstalk.
2. Los logs contienen IP de visitantes y claves de objeto: cifrado y bloqueo público como los demás buckets; retención de noventa días.
3. La entrega de logs es de mejor esfuerzo y con retraso de horas; si la política de entrega está mal, no hay error visible en el `apply`.
4. `prevent_destroy` en el bucket de logs: retirar el entorno exige decidirlo expresamente.
5. Sobrescribir la configuración de logs del bucket de staging si ya tuviera una (por confirmar).

## Pruebas

- Sin pruebas nuevas: no se toca la lógica de ningún script ni nada de `plugins/`.
- Verificación: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `environments/dev` y `environments/prod` (en dev con `AWS_PROFILE=sigmetum-preprod` si `init` pide credenciales); `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs`. Ningún rol ejecuta `plan` ni `apply`.

## Cambios incorporados tras la segunda opinión sobre el plan

1. **Orden de creación (importante):** el output `access_logs_bucket_name` sale de `aws_s3_bucket_policy.access_logs`, para que el logging de `backend-ci-iam` se cree después de la política de entrega (S3 valida el destino al configurar el logging).
2. **Conflictos 409 de S3:** la política del bucket de logs depende también de la propiedad de objetos, el cifrado y el versionado del mismo bucket, para no escribir en paralelo sobre él.
3. **Fragilidad documentada:** la regla `logging` de `quality-check` solo reconoce el bucket de logs como sin registros mientras ningún texto del logging del bucket de datos (ni un comentario) contenga `aws_s3_bucket.access_logs.`; anotarlo junto a los `locals`.
4. **Recuento corregido:** ocho recursos nuevos en `storage` y uno en `backend-ci-iam`, nueve en total.
5. **Entrega y TLS:** que el `Deny` de `aws:SecureTransport` no bloquee la entrega de logs es una inferencia (la entrega de S3 usa HTTPS): queda como (por confirmar) en la verificación posterior al `apply`.

## Hallazgos fuera de la spec

1. La política de entrega depende de `aws:SourceArn` con el ARN de dos buckets de origen; si en el futuro se registra un tercer bucket hay que ampliarla.
2. `related()` de `quality-check` por texto de cuerpo (`aws_s3_bucket.app.`) hace que la política del bucket de logs, al citar `aws_s3_bucket.app.arn`, cuente también como política del bucket de datos; no cambia ningún resultado hoy, pero es una limitación de la regla (posible hallazgo para otro ciclo).
3. `data.aws_region.current.name` se usa por coherencia con `modules/amplify` (proveedor `~> 5.0`).

## Cierre

- Documentos de `integracion` afectados: ninguno de forma real; hace falta la línea `Integración: sin impacto — …` en el aviso de PR para `docs-gate`.
- Segunda opinión: se pide sobre este plan y sobre el diff.
