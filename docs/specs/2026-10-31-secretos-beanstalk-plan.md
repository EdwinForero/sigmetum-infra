# Secretos de Beanstalk en Parameter Store: plan

Fecha: 2026-10-31 · Estado: cerrado (v2, tras "Pedir cambios") · Spec: [design](2026-10-31-secretos-beanstalk-design.md)

## Pre-condiciones del apply (por entorno y por cuenta)

El humano las comprueba antes del `apply`. Si una falla, no se aplica y se vuelve a requisitos (decisión 4: no tocar backend ni plataforma).

1. **Plataforma y espacio de nombres (por confirmar).** `aws:elasticbeanstalk:application:environmentsecrets` exige una versión mínima de plataforma que no se ha contrastado con documentación oficial. La plataforma desplegada puede diferir de `var.solution_stack_name` por `ignore_changes = [solution_stack_name]`; se comprueba la desplegada con comandos de solo lectura:
   - `aws elasticbeanstalk describe-environments --environment-names sigmetum-backend-<env>-env --query "Environments[0].PlatformArn"`
   - `aws elasticbeanstalk describe-configuration-options --environment-name sigmetum-backend-<env>-env --query "Options[?Namespace=='aws:elasticbeanstalk:application:environmentsecrets']"`; si no devuelve nada, el entorno no lo soporta.
2. **Parámetros creados con el procedimiento de abajo** (sin salto de línea final) y verificados.
3. **Quien aplica tiene `iam:PutRolePolicy`** sobre `aws-elasticbeanstalk-ec2-role` en esa cuenta. El rol lo crea a mano `docs/aws-organizations-setup.md`, no Terraform; Terraform solo le añade una política en línea.
4. **Riesgo para la puerta final.** Se mantiene la decisión 5 (`dev` y `prod` a la vez, sin puerta intermedia en `dev`). Un fallo de plataforma o de parámetro que `dev` habría destapado se descubre con `prod` ya aplicándose en la misma sesión. Aceptado por el usuario; la puerta final debe recogerlo.

## Fase 1

1. **Módulo beanstalk: entregar los tres secretos desde Parameter Store y dar permiso al rol de instancia**
   - Archivos: `modules/beanstalk/main.tf` (modificar).
   - Cambios:
     - `locals`: `ssm_secret_names` (mapa clave a nombre `"/sigmetum/${var.environment}/backend/<CLAVE>"`, con barra inicial, para `JWT_SECRET`, `EMAIL_PASSWORD`, `ADMIN_PASSWORD`) y `ssm_secret_arns` (mapa clave a ARN).
     - **Construcción exacta del ARN** (el nombre ya empieza por `/`, no se añade otra tras `parameter`): `"arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${name}"`. Resultado esperado con marcadores: `arn:<partición>:ssm:<región>:<cuenta>:parameter/sigmetum/<env>/backend/JWT_SECRET`. Prohibido `parameter/${name}` (da `parameter//sigmetum/...`). Ningún ARN literal con cuenta ni región.
     - **Revisión a mano (sin `plan`):** el developer lee el literal de la plantilla y comprueba que tras `parameter` solo hay una `/`, la del nombre; el humano lo contrasta con `describe-parameters` (el campo `Name` empieza por `/`) y con el `plan` real antes del `apply` (por confirmar). `terraform console` no se usa (necesita proveedor y credenciales).
     - `data "aws_partition" "current"`, `data "aws_region" "current"` (atributo `.name`, por el rango `~> 5.0`, lock 5.100.0) y `data "aws_caller_identity" "current"`.
     - `aws_iam_role_policy.ssm_secrets`: nombre `sigmetum-ssm-secrets-${var.environment}`; rol `aws-elasticbeanstalk-ec2-role` por nombre; una sentencia `Allow` con `ssm:GetParameters` y `ssm:GetParameter` sobre los tres ARN. Sin comodines. `kms:Decrypt` no se añade con la clave por defecto `aws/ssm` (por confirmar); una CMK propia sería otra decisión.
     - En `aws_elastic_beanstalk_environment.this`, `dynamic "setting"` en `aws:elasticbeanstalk:application:environmentsecrets` iterando `local.ssm_secret_arns` (`name = setting.key`, `value = setting.value`), junto al bloque de `app_env_vars`.
     - `depends_on = [aws_iam_role_policy.ssm_secrets]` en el entorno.
   - **Riesgo de carrera IAM y entorno.** IAM es eventualmente consistente y `depends_on` solo ordena la creación, no garantiza propagación. Si el entorno se actualiza antes de que la política sea visible, las instancias no leen los parámetros y el backend no arranca (falla cerrado). Probabilidad baja: Beanstalk tarda minutos en aplicar la configuración y el permiso suele propagarse en segundos.
     - Mitigación elegida: ninguna en código (sin `provisioner`, `null_resource` ni `local-exec`; `depends_on` ya está).
     - Descartada: `time_sleep` de `hashicorp/time` (añade un proveedor y un rango de versión que nadie ha pedido).
     - Descartada: `apply` en dos pasadas con `-target` (va contra la buena práctica y la decisión 5).
     - **Recuperación si falla:**
       1. Observar, solo lectura: `aws elasticbeanstalk describe-events --environment-name <env> --max-items 20` y `describe-environments` (`Status`, `Health`).
       2. Esperar a `Ready`. Beanstalk revierte una actualización de configuración fallida. No se aborta a mano: `abort-environment-update` cambia recursos y exige confirmación expresa.
       3. Repetir `terraform apply` en ese entorno; la política ya existe y solo se reintenta el update.
       4. Si el entorno queda `Degraded` o `Severe`, se consulta al humano antes de actuar. Si la causa es un parámetro ausente o inválido, se corrige y se repite el `apply`.
   - Prohibido: `data "aws_ssm_parameter"` y cualquier recurso que lea o escriba el valor (lo metería en el estado). Terraform no crea los parámetros.
   - Firmas que cambian: ninguna variable ni output. Se añaden un recurso, tres data sources, dos locals y un bloque dinámico de settings.
   - Comprobación: `terraform fmt -check -recursive` y `terraform validate` en `environments/dev` y `environments/prod`. No `plan`. Revisión a mano del ARN.
   - Norma: `docs/guias/seguridad.md` SEG-2 y SEG-4; `docs/guias/buenas-practicas-terraform.md`; `docs/integracion/para-backend.md` sección 2 (los nombres no cambian).

2. **Validation de `app_env_vars`**
   - Archivos: `modules/beanstalk/variables.tf` (modificar).
   - Cambios:
     - Lista requerida: `JWT_EXPIRATION`, `ADMIN_USERNAME`, `EMAIL`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN`. `TRUST_PROXY_HOPS` sigue permitida (opcional).
     - Segunda validation que falla si aparece `JWT_SECRET`, `EMAIL_PASSWORD` o `ADMIN_PASSWORD`; el mensaje solo cita nombres y remite al procedimiento.
     - Se actualiza la `description` (los secretos viven en Parameter Store). `sensitive = true` se mantiene.
   - Firmas que cambian: la validation de `app_env_vars` y su descripción.
   - **Vuelta atrás.** Revertir exige revertir el commit completo, no solo `main.tf`: la validation nueva rechaza las tres claves, así que reponerlas como propiedades de entorno obliga a restaurar también `variables.tf` y a volver a poner los valores en `terraform.tfvars`. La política IAM y los parámetros no se borran solos; el humano los elimina aparte, con confirmación.
   - Comprobación: `terraform validate` en los dos entornos (no evalúa valores). Manual: `-var` con un tfvars temporal fuera del repo (p. ej. scratchpad; no se lee el real): con las seis claves pasa, con una de las tres secretas falla. Por confirmar si `terraform console` dispara la validation; si no, queda para el humano con `plan` antes del `apply` y se anota.
   - Norma: `docs/guias/buenas-practicas-terraform.md`; `docs/integracion/para-backend.md` sección 2.

3. **Plantillas `terraform.tfvars.example` de los dos entornos**
   - Archivos: `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example` (modificar).
   - Cambios: quitar `JWT_SECRET`, `ADMIN_PASSWORD` y `EMAIL_PASSWORD` de `app_env_vars`; dejar un comentario que remita al procedimiento, solo con marcadores y nombres de parámetro. Las demás claves igual (criterio 7); los dos entornos no divergen (criterio 8).
   - Firmas que cambian: ninguna.
   - Comprobación: `node scripts/docs-check.mjs` y `node scripts/quality-check.mjs` (exige el paso 4 y la documentación).
   - Norma: regla de secretos de `CLAUDE.md`.

4. **Scripts de coherencia**
   - Archivos: `scripts/quality-check.mjs` y `scripts/docs-check.mjs` (modificar).
   - Cambios:
     - `quality-check`, comprobación 5 (líneas 361 a 375): hoy solo AVISA, no falla. Las tres claves dejan de salir como «no define X, que el backend exige»; se dan por cubiertas con la referencia fija de esos tres nombres. Cambio acotado que no debilita ninguna regla de seguridad.
     - `docs-check`: `docAppKeys` (línea 458) suma las filas de la nueva sección de `docs/referencia-modulos.md`. Esa comparación con el backend es aviso (falla con `--strict`). La comparación `.example` contra tabla (líneas 351 a 363) sí falla y sigue usando solo la tabla `app_env_vars`. La columna 2 de las filas nuevas debe empezar por «sí» (`/^s[ií]/i`, línea 469).
     - La métrica de claves de `app_env_vars` (línea 133) baja en 3: el developer lo señala para que el tester actualice la cifra.
     - Antes de tocar el código, el developer lee `section(...)` para ver cómo se localiza el encabezado.
   - Firmas que cambian: solo la lógica interna de las dos comprobaciones.
   - Comprobación: `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` (también `--strict`) sin avisos nuevos; lo hace el tester tras los documentos.
   - Norma: `docs/guias/mantenimiento.md` sección 2 (scripts); «Los fallos de la puerta se corrigen, no se silencian» (`CLAUDE.md`).

## A cargo del tester-documentador

- `docs/referencia-modulos.md`: la tabla `app_env_vars` pierde las tres claves; nueva sección con los tres secretos (variable, columna 2 «sí…», nombre del parámetro por entorno, SecureString); documentar la política IAM (`sigmetum-ssm-secrets-<env>` sobre `aws-elasticbeanstalk-ec2-role`) y la validation nueva.
- `docs/estado-y-deuda-tecnica.md`: S6 y S2 con su estado real (resuelto en código, pendiente de `apply` y de crear los parámetros; S2 parcial mientras `terraform.tfvars` y versiones previas del estado conserven los valores antiguos); cifra de `app_env_vars` −3; «Última actualización» con la fecha de hoy; rotación pospuesta como seguimiento; riesgos de la puerta final (ver Cierre).
- `docs/guias/seguridad.md`: SEG-2 y SEG-3 con el nuevo modo de entrega; cerrar o mantener la nota «por confirmar» según lo comprobado. El procedimiento humano vive aquí o en `para-backend.md`.
- `docs/integracion/para-backend.md`: sección 2 (tabla y párrafo «Cómo llegan hoy», nombres sin cambio), sección 10 al día y la política IAM nueva en la sección 4.
- `docs/aws-organizations-setup.md`: nota de que la política SSM la crea Terraform (no a mano) y de que quien aplica necesita `iam:PutRolePolicy` sobre `aws-elasticbeanstalk-ec2-role`. Sin ARN ni cuentas literales.
- `docs/guias/mantenimiento.md`: secciones 2 y 3.1 solo si procede; si no cambia nada, se dice.
- `README.md`: `dev` y `prod` usan el mismo mecanismo y solo difiere el nombre del parámetro.
- **Procedimiento humano** (**por confirmar** hasta ejecutarse; solo nombres y marcadores, nunca valores):
  - **Crear cada parámetro sin salto de línea final.** Un `file://` con `\n` final guarda `"\n"` y `validateEnv.js` lo rechaza (ADMIN_PASSWORD es un bcrypt con `$`).
    - PowerShell (la entrada de `Read-Host` no va al historial ni expande `$`): `$s = Read-Host -AsSecureString "valor"`; `$v = [System.Net.NetworkCredential]::new('', $s).Password`; `$f = Join-Path $env:TEMP "p.tmp"`; `[IO.File]::WriteAllText($f, $v)`; `aws ssm put-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --type SecureString --value "file://$f" --overwrite`; `Remove-Item $f`.
    - Bash: `read -rs v; f=$(mktemp); printf '%s' "$v" > "$f"; aws ssm put-parameter ... --value "file://$f"; rm -f "$f"` (`printf '%s'` no añade salto; `read -r` no expande `$`).
    - Nunca el valor entre comillas dobles en el terminal ni en `--value` por línea de comandos. Antes de subir, el archivo debe pesar 60 bytes para un bcrypt; uno más indica salto final. Archivo temporal fuera del repo y borrado después (no hay borrado seguro garantizado, por confirmar).
  - **Verificar que existen:** `aws ssm describe-parameters`, sin leer el valor.
  - **Verificar el valor sin imprimirlo** (por confirmar; exige `ssm:GetParameter` con descifrado al operador): leer a una variable y mostrar solo longitud y prefijo (60 y `$2` para el bcrypt). Sin `echo` del valor.
  - Quitar las tres claves de `app_env_vars` en `terraform.tfvars` (lo hace el humano).
  - Comprobar las pre-condiciones del apply y ejecutar `apply` en `dev` y `prod` en la misma sesión.
  - **Tras el apply, verificar que el valor llega sin expandir `$`** (por confirmar): salud `Ok` y arranque sin error de `validateEnv.js` (exige el bcrypt completo); login real del administrador; opcional con acceso a la instancia (SSH está deshabilitado por defecto), `get-config environment -k ADMIN_PASSWORD` comprobando solo longitud.
  - **Rotación:** sobrescribir el parámetro con el mismo método; reiniciar o redesplegar para que se relea (por confirmar si basta el reinicio); comprobar el health check.
- Resumen final: backend sin cambios de código (si falla la lectura del secreto no arranca; `prod` se reinicia con el `apply`); frontend sin cambios; orden: parámetros, pre-condiciones, `terraform.tfvars` sin las tres claves, `apply` en ambos entornos; los valores antiguos siguen en versiones previas del estado (bucket versionado), riesgo anotado por la rotación pospuesta.

## Pruebas

- Sin pruebas automáticas nuevas: la infraestructura no tiene base de tests y no se toca `plugins/`.
- Verificación: `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `node scripts/quality-check.mjs`, `node scripts/docs-check.mjs` (también `--strict`) y `node plugins/ciclo-agentico/scripts/docs-gate.mjs`.
- Criterios de aceptación 1 y 9 de la spec: **por confirmar** en cuenta, tras el `apply` del humano.

## Cierre

- **Crítico: sí** (IAM y permisos; secretos y `terraform.tfvars`; contrato con el backend, `app_env_vars`; las tres son entradas de `criticidad` de `.claude/flujo.json`).
- Riesgos para la puerta final: `dev` y `prod` a la vez (decisión 5), sin detección previa en `dev`; el `apply` reconfigura el entorno y puede reiniciar el backend (en `prod`, Rolling); si faltan parámetros, permiso o propagación IAM, el backend no arranca; revertir exige revertir el commit completo; la plataforma desplegada puede no soportar `environmentsecrets` (por confirmar); el valor antiguo persiste en versiones previas del estado.
- Documentos de integración afectados: `docs/integracion/para-backend.md`. `para-frontend.md` no.
- Supuestos sin verificar: `environmentsecrets` y su versión mínima de plataforma (pre-condición 1); `kms:Decrypt` innecesario con `aws/ssm`; `aws_region.name` frente a `.region`; si `terraform console` dispara la validation.
