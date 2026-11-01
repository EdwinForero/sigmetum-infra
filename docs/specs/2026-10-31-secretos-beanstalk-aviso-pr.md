# Aviso para PR: secretos de Beanstalk en Parameter Store

Fecha: 2026-10-31 · Spec: `docs/specs/2026-10-31-secretos-beanstalk-design.md` · Plan: `docs/specs/2026-10-31-secretos-beanstalk-plan.md`

Crítico: sí (IAM y permisos; secretos y `terraform.tfvars`; contrato con el backend, `app_env_vars`). Solo marcadores y nombres: ningún valor, hash ni ARN con cuenta.

## Qué cambia

- `modules/beanstalk/main.tf`: los secretos `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` llegan desde Parameter Store (`SecureString`, parámetro `/sigmetum/<env>/backend/<CLAVE>`) con un `dynamic "setting"` del espacio de nombres `aws:elasticbeanstalk:application:environmentsecrets`; tres data sources (`aws_partition`, `aws_region`, `aws_caller_identity`) para construir el ARN; política en línea `sigmetum-ssm-secrets-<env>` sobre `aws-elasticbeanstalk-ec2-role` (`ssm:GetParameters` y `ssm:GetParameter` solo sobre los tres ARN, sin comodines); `depends_on` del entorno. Un recurso nuevo. Terraform no crea los parámetros ni lee su valor: los valores no entran en el estado.
- `modules/beanstalk/variables.tf`: `app_env_vars` exige seis claves no secretas y una segunda `validation` rechaza las tres secretas.
- `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example`: sin las tres claves; comentario que remite al procedimiento. `dev` y `prod` usan el mismo mecanismo y solo difiere el nombre del parámetro.
- `scripts/quality-check.mjs` y `scripts/docs-check.mjs`: las tres claves se dan por cubiertas por Parameter Store (la comprobación contra el backend solo avisa) y `docs-check` lee la sección nueva de la referencia.
- Documentación: `docs/referencia-modulos.md` (sección `Secretos en Parameter Store`), `docs/integracion/para-backend.md` (secciones 2, 5 y 10, con el procedimiento humano completo), `docs/aws-organizations-setup.md`, `README.md` y `docs/estado-y-deuda-tecnica.md` (S6 resuelto en código, S2 parcial; métricas: claves de `app_env_vars` de 11 a 8, recursos de 36 a 37).

## Frontend y backend

- **Frontend:** sin cambios ni acciones. `para-frontend.md` no se toca.
- **Backend:** sin cambios de código. Sigue recibiendo las nueve variables con los mismos nombres y las mismas reglas de `validateEnv.js` (`JWT_SECRET` de al menos 32 caracteres, `ADMIN_PASSWORD` con el bcrypt completo). Solo cambia cómo llegan las tres secretas. **El `apply` reconfigura el entorno y puede reiniciar la aplicación** (en `prod`, gradual). Si falta un parámetro, falta el permiso o este no se ha propagado, el backend no arranca (falla cerrado).
- **Orden de despliegue:** 1) parámetros en cada cuenta; 2) pre-condiciones; 3) `terraform.tfvars` sin las tres claves; 4) `apply` en `dev` y en `prod` en la misma sesión; 5) rotación, aparte y después.

## Qué debe hacer el humano, en este orden

Procedimiento completo, con los comandos de PowerShell y Bash: [para-backend.md](../integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano). Resumen por entorno (`dev` con el perfil de preprod, `prod` con el de prod):

1. **Pre-condiciones (solo lectura):** (a) la plataforma desplegada admite `environmentsecrets` (`describe-environments` y `describe-configuration-options` filtrando ese espacio de nombres; si no devuelve nada, **no se aplica** y se vuelve a requisitos); (b) quien aplica tiene `iam:PutRolePolicy` sobre `aws-elasticbeanstalk-ec2-role`.
2. **Crear los tres parámetros** `/sigmetum/<env>/backend/<CLAVE>` (`SecureString`) sin salto de línea final, midiendo antes el archivo temporal (un bcrypt, 60 bytes) y con limpieza aunque falle `aws`; nunca el valor en `--value` por línea de comandos. Se migran los valores actuales. Comandos y salvedad de Git Bash (`cygpath -m`): [procedimiento](../integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano).
3. **Verificar:** `describe-parameters` (existen; `Name` empieza por `/`), sin leer el valor; opcionalmente, longitud y prefijo sin imprimirlo (comandos en el procedimiento).
4. **Quitar** `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` de `app_env_vars` en el `terraform.tfvars` de cada entorno (si siguen, `plan` falla por la `validation`).
5. **`terraform plan`** en cada entorno, sin pegar su salida.
6. **`terraform apply`** en `dev` y `prod` en la misma sesión (decisión del usuario del 31/10/2026).
7. **Tras el `apply`:** salud `Ok`, arranque sin error de `validateEnv.js`, login real del administrador y que la configuración del entorno ya no liste las tres claves como propiedades de entorno.

## Qué mirar en el `plan`

Sin pegar la salida. Esperado por entorno:

- **Un recurso nuevo:** `aws_iam_role_policy.ssm_secrets` (`sigmetum-ssm-secrets-<env>`), con tres ARN `...:parameter/sigmetum/<env>/backend/<CLAVE>`: **una sola `/` tras `parameter`** y ninguna `//`; partición, región y cuenta correctas para ese entorno.
- **Una modificación en sitio** del entorno de Beanstalk: tres settings nuevos de `environmentsecrets` y ninguna sustitución. Si el `plan` propone reemplazar el entorno, parar.
- Que las tres claves ya no aparezcan en `aws:elasticbeanstalk:application:environment`.
- Que `ADMIN_PASSWORD`, `JWT_SECRET` y `EMAIL_PASSWORD` no salgan como valores en ningún sitio del `plan`.
- La `validation` solo se evalúa con el `terraform.tfvars` real: si falla, falta alguna de las seis claves o quedan las tres secretas.

## Riesgos para la puerta final

1. **`dev` y `prod` a la vez, sin puerta intermedia en `dev`:** un fallo de plataforma o de parámetro que `dev` habría destapado se descubre con `prod` ya aplicándose. Aceptado por el usuario.
2. **Reinicio del backend** con el `apply` (en `prod`, gradual); si falta un parámetro, el permiso o la propagación de IAM, el backend no arranca. Recuperación: solo lectura (`describe-events`, `describe-environments`), esperar a `Ready` (Beanstalk revierte), repetir el `apply`; no se aborta a mano. Si queda `Degraded` o `Severe`, consultar antes de actuar.
3. **Plataforma sin `environmentsecrets` (por confirmar):** su versión mínima no se contrastó con la documentación oficial.
4. **Revertir** exige revertir el commit completo (`main.tf`, `variables.tf` y volver a poner los valores en `terraform.tfvars`); la política IAM y los parámetros no se borran solos (los elimina el humano, con confirmación expresa).
5. **S2 sigue parcial:** los valores antiguos persisten en versiones previas del estado (bucket versionado) y en el `terraform.tfvars` local hasta quitar las claves; la rotación se pospone (decisión del usuario).

## Por confirmar

- `environmentsecrets` y su versión mínima de plataforma en cada cuenta.
- `kms:Decrypt` innecesario con la clave por defecto `aws/ssm` (una clave propia sería otra decisión).
- Propagación de IAM antes de la actualización del entorno.
- `aws_region.name` frente a `.region` (el proveedor está fijado en `~> 5.0`, lock 5.100.0; `validate` en verde).
- Si `terraform console` dispara la `validation` (no se usó; queda para el `plan` del humano).
- Que el valor llega sin expandir `$` y sin salto de línea; borrado seguro del archivo temporal.
- Criterios de aceptación 1 y 9 de la spec: solo comprobables en cuenta, tras el `apply`.
- Rotación: si basta el reinicio para que se relea el parámetro.
