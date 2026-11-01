# Registros de acceso de S3 (ciclo D1): spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

Cerrar en código la parte «registros de acceso» de S5 y el hallazgo M11 de `docs/estado-y-deuda-tecnica.md`. Hoy ni el bucket de datos ni el bucket de staging de Beanstalk registran accesos. Se añade un bucket de logs de acceso por entorno y se activan los registros en esos dos buckets. Es un cambio crítico (bucket de datos, política de buckets, puerta de calidad). Este ciclo queda reducido a D1; S11 y S9 pasan a un ciclo D2 posterior (ver «Fuera de alcance»).

## Decisiones registradas

1. Alcance: solo D1 (S5 parte registros de acceso, y M11). S11 (CloudTrail, facturación, `StreamLogs`) y S9 (autenticación básica en dev) quedan para D2.
2. Un bucket de logs de acceso por entorno (`dev` y `prod` separados, cada uno en la cuenta de su entorno). Los logs expiran a los noventa días.
3. M11: se declara solo `aws_s3_bucket_logging` sobre el bucket de staging de Beanstalk, que ya existe en `dev` y `prod`, apuntando a él por su nombre derivado de región y cuenta (con `data.aws_caller_identity` y la región del proveedor; sin identificadores literales). Terraform toma el control del ajuste de logs de ese bucket.
4. `scripts/quality-check.mjs`: solo cambian los datos de `KNOWN_DEBT.buckets`; no se toca la lógica del script. Se añade una excepción nueva para el bucket de logs (no puede registrarse a sí mismo) con el id de hallazgo nuevo M15 (siguiente libre de la serie M de infra: el estado llega a M14; M21 es un hallazgo del backend). Se retira la excepción obsoleta `modules/backend-ci-iam:deploys` (su id `M9` es otro hallazgo del estado y ese recurso no existe en Terraform) y la de `modules/storage:app` (S5), que deja de ser deuda.

## Hechos verificados en el código (condicionan la spec)

- El bucket de datos (`modules/storage`, recurso `app`) ya tiene bloqueo de acceso público, cifrado AES256, versionado, ciclo de vida, `DenyInsecureTransport` y `prevent_destroy`. Solo le falta `aws_s3_bucket_logging`; es la excepción `S5` de `KNOWN_DEBT.buckets`. Tiene una única política (`aws_s3_bucket_policy`) con `AllowCloudFrontOAC` y `DenyInsecureTransport`.
- `modules/backend-ci-iam` no declara ningún `aws_s3_bucket`: el bucket de staging `elasticbeanstalk-<región>-<cuenta>` lo crea Beanstalk; Terraform solo da permisos de CI sobre él. La entrada `modules/backend-ci-iam:deploys` de `KNOWN_DEBT.buckets` es obsoleta. `quality-check` no inspecciona ese bucket (no hay recurso `aws_s3_bucket`).
- La regla `logging` de `quality-check` exige un `aws_s3_bucket_logging` para todo `aws_s3_bucket`; exige además versionado `Enabled`, cifrado, bloqueo público, política con `aws:SecureTransport` y `prevent_destroy`. Un bucket de logs que no se registra a sí mismo incumple `logging` y necesita la excepción nueva.
- No hay hoy ningún bucket de logs ni recurso de logging en los `.tf`.

## Criterios de aceptación

### De código

1. Existe un bucket de logs de acceso por entorno, gestionado por Terraform, con: bloqueo de acceso público con sus cuatro opciones en `true`; cifrado AES256; versionado `Enabled`; `prevent_destroy = true`; etiqueta `Component`; política propia (ver 2 y 3); regla de ciclo de vida (ver 4). Se comprueba con `node scripts/quality-check.mjs` y la revisión del plan por el humano.
2. La política del bucket de logs incluye una sentencia `Deny` por `aws:SecureTransport = false` y una sentencia `Allow` para el servicio de entrega de logs de S3 (`logging.s3.amazonaws.com`, `s3:PutObject` sobre el prefijo de logs), con condiciones `aws:SourceArn` (los buckets de origen del mismo entorno: bucket de datos y bucket de staging) y `aws:SourceAccount` (la cuenta del entorno, obtenida por data source, nunca literal). Ninguna sentencia `Allow` usa `Principal "*"`.
3. Mecanismo de entrega (razonamiento). Es la política de bucket con el principal de servicio y las dos condiciones. La entrega por ACL (`log-delivery-write` con propiedad de objetos que admite ACL) es el método heredado: AWS recomienda la política y mantener las ACL desactivadas (propiedad `BucketOwnerEnforced`). Por tanto el bucket de logs usa la política y no ACL; si la entrega no funcionara con la política, se anota como riesgo y se vuelve a preguntar, no se cambia en silencio. El cifrado por defecto del destino debe ser SSE-S3 (AES256), compatible con la entrega de logs (no se usa KMS). Origen y destino están en la misma región.
4. Ciclo de vida del bucket de logs. El versionado es obligatorio por la regla de `quality-check`, pero no basta por sí solo: con versionado, expirar el objeto actual a los noventa días solo crea un marcador de borrado y la versión anterior seguiría almacenada (y facturándose) para siempre. Por tanto la regla de ciclo de vida expira los objetos actuales a los noventa días, expira también las versiones no actuales (plazo corto, a fijar por el architect), limpia los marcadores de borrado huérfanos y aborta cargas multipart incompletas.
5. El bucket de datos (`modules/storage:app`) tiene `aws_s3_bucket_logging` hacia el bucket de logs de su entorno, con un prefijo propio. Añadir ese recurso no fuerza recreación del bucket de datos. La política del bucket de datos no cambia: conserva `AllowCloudFrontOAC` y `DenyInsecureTransport`, y no se mezcla con la política del bucket de logs, que es otro `aws_s3_bucket_policy` sobre otro bucket.
6. M11: existe un `aws_s3_bucket_logging` sobre el bucket de staging de Beanstalk (sin recurso `aws_s3_bucket` que lo represente), con destino el bucket de logs del mismo entorno, prefijo distinto del bucket de datos, y nombre del bucket derivado de región y cuenta sin identificadores literales.
7. El bucket de logs no registra sus propios accesos (sin bucle). En `scripts/quality-check.mjs` solo cambian datos de `KNOWN_DEBT.buckets`: sale `modules/storage:app` (S5), sale `modules/backend-ci-iam:deploys`, entra el bucket de logs con el id M15 (la entrada cubre solo `logging`; TLS, versionado y el resto de reglas se cumplen sin excepción). La lógica del script y sus pruebas no se tocan.
8. El plan que revisa el humano antes del `apply` solo añade recursos: ninguna destrucción ni recreación del bucket de datos, de su política ni de ningún otro recurso existente. Ningún rol ejecuta `plan` ni `apply`.
9. `terraform fmt -check -recursive`, `terraform validate` en `dev` y en `prod` y `node scripts/quality-check.mjs` pasan. `dev` y `prod` quedan con la misma estructura de logs (diferencias solo de valores, explicadas en el `README`).
10. Verificación posterior al `apply`, a cargo del humano: pasadas unas horas aparecen objetos de log en el bucket de logs, con el prefijo del bucket de datos y el del bucket de staging. Es la forma de comprobar que la entrega funciona **(por confirmar)**; la entrega es de mejor esfuerzo y tiene retraso.

### De documentación

1. `docs/estado-y-deuda-tecnica.md`: S5 (parte registros de acceso) y M11 pasan a «resuelto en código»; el efecto real queda **por confirmar** hasta el `apply` y la aparición de logs (S5 mantiene lo que no sea esta parte, si lo hay). M11 lleva la salvedad de la cuenta nueva (ver Riesgos). Se añade M15 (el bucket de logs no puede registrarse a sí mismo; excepción aceptada en `KNOWN_DEBT`). La entrada obsoleta `backend-ci-iam:deploys` se anota como retirada. «Última actualización» con la fecha de hoy. El recuento de recursos declarados cambia y vive solo en este documento (`docs-check` lo contrasta).
2. `docs/referencia-modulos.md`: variables, outputs y recursos nuevos o cambiados donde se declaren; las cifras, con letras.
3. `docs/guias/seguridad.md`: SEG-6 (registros de acceso) alineado con el código. `docs/guias/mantenimiento.md` solo si cambia algo de lo que describe de `quality-check` (no cambia la lógica).
4. `README.md` e `docs/iam-role-setup.md` según `docsPorArea`; en el `README`, el bucket de logs, su retención de noventa días y que `dev` y `prod` tienen uno cada uno.
5. `docs/integracion/para-frontend.md` y `docs/integracion/para-backend.md`: no cambian (ver «Impacto en contratos externos»).
6. Sin valores reales, ARN ni identificadores de cuenta en ningún documento (solo marcadores y nombres de variables); sin «número + módulos, entornos, recursos, variables, outputs, archivos, claves» en las cifras.

## Riesgos

- Cuenta nueva: el bucket de staging lo crea Beanstalk, no Terraform. En una cuenta sin él, el `apply` del `aws_s3_bucket_logging` de M11 falla hasta que Beanstalk lo cree (primer despliegue de un entorno). Es un límite conocido; el orden en una cuenta nueva lo define el architect.
- Control del ajuste: Terraform pasa a gestionar los logs de ese bucket ajeno a su estado; cualquier configuración de logs que tuviera se sobrescribe, y un cambio manual posterior aparecerá como deriva.
- Entrega de logs: es de mejor esfuerzo y con retraso de horas; si la política de entrega es incorrecta, no hay error visible en el `apply` y solo se nota por la ausencia de objetos (criterio 10).
- Sin ciclo de vida de versiones no actuales, el coste del bucket de logs crecería sin límite (criterio 4).
- Los logs de acceso contienen IP de clientes y claves de objeto: se tratan con el mismo bloqueo y cifrado que el resto; la retención de noventa días es la decisión vigente.
- `prevent_destroy` en el bucket de logs: retirar el entorno exige antes una decisión explícita.

## Fuera de alcance

- D2 (ciclo posterior): S11 (CloudTrail, alertas de facturación, `StreamLogs` de Beanstalk) y S9 (autenticación básica en dev). Preguntas ya identificadas para D2: dónde van CloudTrail y facturación (por entorno con Terraform o a nivel de organización); umbral de facturación y correo (`notification_email`); formato de las credenciales de S9 (`usuario:contraseña` en claro o ya codificadas) y su efecto en las pruebas de Playwright contra la URL de dev.
- S2/S6 (secretos de Beanstalk), S13, S14, M3, M9, M10, S10, S12 y cualquier cambio de backend o frontend.
- Registros de acceso de CloudFront, del ALB o de Amplify; flow logs de VPC.
- Aplicar, planificar o tocar la cuenta de AWS (lo hace el humano); leer `terraform.tfvars`.
- Cambios del CORS del backend, de `app_env_vars`, de las variables `VITE_*`, del `build_spec`, de dominios o de región.
- Cambiar la lógica de `scripts/quality-check.mjs`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta (la distribución de CloudFront, el acceso por OAC y las variables `VITE_*` no cambian).
- `docs/integracion/para-backend.md`: no lo afecta (el rol de Beanstalk no recibe acceso al bucket de logs; `app_env_vars`, health check, ALB, DNS y CORS no cambian; el rol de CI no cambia de permisos).
- Orden de despliegue: Terraform en `dev` primero, comprobar la aparición de logs, luego `prod`; backend y frontend no necesitan desplegar nada.

## Preguntas abiertas

Ninguna.
