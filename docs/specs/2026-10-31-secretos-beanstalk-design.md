# Secretos de Beanstalk fuera de las propiedades de entorno: spec

Estado: revertido el 31/10/2026 por [login con Cognito](2026-10-31-cognito-login-design.md)

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

Hoy `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` (hash bcrypt) llegan a Beanstalk como propiedades de entorno en claro, legibles en la consola o la API por quien pueda leer la configuración del entorno (S6), y se guardan también en `terraform.tfvars` y en el estado remoto (S2, SEG-2, SEG-3). La tarea es que esos tres secretos dejen de ser propiedades de entorno en claro y vivan en un almacén de secretos gestionado de AWS, en `dev` y `prod`, sin que el backend deje de arrancar.

## Criterios de aceptación

### De código

1. Tras el cambio, ninguno de los tres secretos aparece como propiedad de entorno en claro en la configuración del entorno de Beanstalk de `dev` ni de `prod` (observación con la configuración del entorno, solo nombres; **por confirmar** en cuenta tras el `apply`, que ejecuta el humano).
2. El backend sigue recibiendo `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` con los mismos nombres, y `validateEnv.js` sigue pasando sin cambios de código en el backend; las reglas de valor (JWT_SECRET de al menos 32 caracteres, ADMIN_PASSWORD hash bcrypt completo) se siguen cumpliendo.
3. Solo el rol de las instancias del entorno puede leer esos secretos, con permisos acotados a ellos (sin comodines, SEG-4).
4. Ningún valor de secreto queda en archivos versionados, en `*.example`, en documentos ni en salidas de Terraform (marcadores y nombres de variables solamente).
5. El estado de Terraform y `terraform.tfvars` dejan de contener los valores de los tres secretos (decisión 2); las claves salen de `app_env_vars` y Terraform solo conoce los nombres de los parámetros.
6. `terraform fmt -check -recursive`, `terraform validate` en `environments/dev` y `environments/prod`, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` pasan. La regla de `quality-check` sobre `sensitive = true` en `app_env_vars` sigue cumpliéndose o se adapta de forma justificada.
7. Las claves no secretas de `app_env_vars` (`JWT_EXPIRATION`, `ADMIN_USERNAME`, `EMAIL`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN`, `TRUST_PROXY_HOPS`) siguen llegando como hasta ahora.
8. `dev` y `prod` no divergen sin explicarlo en el README.
9. Existe un procedimiento verificable para el primer despliegue y para rotar un secreto, sin interrupción no prevista del backend ni valores en claro en el historial (**por confirmar** su ejecución).

### De documentación

1. `docs/estado-y-deuda-tecnica.md`: S6 y S2 actualizados con su estado real (resuelto en código, pendiente de `apply`, o parcial) y "Última actualización" con la fecha de hoy.
2. `docs/guias/seguridad.md`: SEG-2 y SEG-3 reflejan el nuevo modo de entrega de secretos y el estado resultante; se cierra la nota "por confirmar" sobre la plataforma de Beanstalk si se comprueba.
3. `docs/integracion/para-backend.md`: sección 2 (tabla "La define `app_env_vars` hoy" y párrafo "Cómo llegan hoy") y sección 10 al día, dejando claro que el contrato de nombres no cambia.
4. `docs/referencia-modulos.md`: variables, outputs y claves de `app_env_vars` afectadas; README y `*.example` de ambos entornos al día.
5. El resumen final indica qué deben hacer los otros repositorios y el orden de despliegue.

## Fuera de alcance

- Cambios en el código del backend (decisión 4: condición de no tocarlo).
- Rotar los valores actuales de los secretos (decisión 3: se migran y se rotan después).
- S10 (token de GitHub de Amplify) y el resto de secretos fuera de las tres variables citadas, salvo que se decida otra cosa.
- Restringir quién lee el bucket de estado más allá de lo que ya cubre SEG-3.
- Ejecutar `terraform apply`, `plan`, `import` o `state`, o comandos de AWS que cambien recursos.

## Impacto en contratos externos

- `docs/integracion/para-backend.md`: lo afecta. Cambia cómo llegan tres variables de `app_env_vars` (sección 2); los nombres y las reglas de `validateEnv.js` no cambian. Un `apply` reconfigura el entorno y puede reiniciar la aplicación. Si falla la lectura del secreto, el backend no arranca (falla cerrado). Orden de despliegue: el humano crea los parámetros en cada cuenta antes del `apply`; `dev` y `prod` a la vez. Rotación: aparte, después.
- `docs/integracion/para-frontend.md`: no lo afecta.

## Decisiones del usuario (31/10/2026)

1. **Servicio:** Parameter Store (SecureString).
2. **Origen:** el humano crea los parámetros y da valor fuera de Terraform; Terraform solo los referencia. Los valores no entran en el estado ni en `terraform.tfvars` (resuelve S2 de verdad). Hay un paso manual por entorno y un orden de despliegue: primero los parámetros, después el `apply`.
3. **Rotación:** se migran los valores actuales; rotar es un paso aparte, posterior.
4. **Plataforma:** condición firme, **no tocar el backend**: este sigue leyendo las mismas variables de entorno. Si la plataforma actual de Beanstalk no lo permite con Parameter Store, el architect lo veta con motivo y se vuelve a requisitos.
5. **Despliegue:** `dev` y `prod` a la vez (un `apply` por entorno en la misma sesión, lo ejecuta el humano). Sin puerta de decisión intermedia en `dev`; los riesgos de reinicio de `prod` van a la puerta final.

## Preguntas abiertas

Ninguna.
