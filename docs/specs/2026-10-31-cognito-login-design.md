# Login de administrador con Amazon Cognito (parte de infraestructura): spec

Fecha: 2026-10-31 · Estado: cerrado

Nota: Modificado por [corte único](2026-10-31-cognito-corte-unico-design.md): decisiones 1, 5 y 10.

## Objetivo

Hoy el administrador entra con un usuario y un hash bcrypt (`ADMIN_USERNAME`, `ADMIN_PASSWORD`) y el backend firma un JWT propio con `JWT_SECRET` (`POST /log`, `GET /auth`, middleware `tokenAuth`); el frontend guarda ese token en `localStorage` y lo envía como `Authorization: Bearer`. Se quiere sustituir ese login por Amazon Cognito. Esta spec cubre solo la parte de infraestructura: que cada entorno (`dev` y `prod`, en cuentas distintas) tenga su propio servicio de identidad, que se publiquen los identificadores no secretos que backend y frontend necesitan, y que los contratos de integración fijen el orden de despliegue y las tareas de los otros dos repositorios.

Además, revierte una parte del commit `0885804` (aún no aplicado en AWS): `EMAIL_PASSWORD` vuelve a `app_env_vars`. `JWT_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` también vuelven a `app_env_vars` durante la transición y se retira la maquinaria de Parameter Store (decisión 1).

Supuestos de partida (declarados, sin confirmar):

- Los recursos de Cognito viven en la región del proveedor de cada entorno (hoy `eu-west-3`, **por confirmar** que Cognito esté disponible y sea la deseada).
- Hay dos usuarios administradores (el habitual y uno de emergencia en manos de otra persona, decisión del usuario del 31/10/2026); no hay registro público de usuarios. Por la decisión 4, cualquier usuario del pool es administrador completo (C16).
- Los identificadores que van a backend y frontend (región, id del grupo de usuarios, id del cliente) no son secretos.
- Los parámetros de Parameter Store del commit `0885804` no se han creado ni aplicado en ninguna cuenta (dato del usuario), así que no hay secretos que migrar de vuelta.

## Criterios de aceptación

### De código

1. Cada entorno (`dev`, `prod`) declara su propio grupo de usuarios y su cliente de aplicación; `terraform fmt -check -recursive` y `terraform validate` en `environments/dev` y `environments/prod` pasan.
2. Los dos entornos exponen como outputs los identificadores no secretos necesarios para validar tokens (región, id del grupo de usuarios, id del cliente) y para el flujo de login del frontend (los de la decisión 2: dominio del grupo, id del cliente y direcciones de retorno); ningún output ni variable contiene un secreto, y `quality-check` lo confirma.
3. El cliente de la aplicación del frontend no tiene secreto de cliente. Si el diseño final exigiera uno, es un cambio de la spec y vuelve a requisitos.
4. El registro público de usuarios queda cerrado en ambos entornos y la política de contraseñas y de MFA es la de la decisión 4 (MFA TOTP obligatorio, sin registro público).
5. Los recursos de identidad de `prod` están protegidos contra borrado accidental (criterio de la guía de buenas prácticas para recursos con datos de usuarios); una destrucción o reemplazo en el `plan` es motivo de parar.
6. `EMAIL_PASSWORD` vuelve a `app_env_vars` en `modules/beanstalk`: la `validation` que exige claves por nombre la incluye, la `validation` que rechaza claves secretas deja de nombrarla, la política IAM `sigmetum-ssm-secrets-<env>` y el espacio de nombres `environmentsecrets` dejan de cubrirla, y las plantillas `terraform.tfvars.example` la incluyen como marcador (nunca un valor). `quality-check` y `docs-check` pasan con ese estado.
7. El tratamiento de `JWT_SECRET`, `ADMIN_PASSWORD` y `ADMIN_USERNAME` en código es el de la decisión 1 (vuelven a `app_env_vars`); mientras el backend los siga exigiendo en `config/validateEnv.js`, ningún cambio de esta spec puede dejar al backend sin ellos.
8. `quality-check` y `docs-check` pasan (también `--strict` en `docs-check`); si hay deuda nueva se anota en `docs/estado-y-deuda-tecnica.md` y, si procede, en `KNOWN_DEBT`.
9. El `plan` humano de cada entorno solo muestra creaciones de identidad y los cambios de `EMAIL_PASSWORD` y, en su caso, de la maquinaria de Parameter Store; ningún reemplazo ni destrucción de recursos existentes **(por confirmar, lo comprueba el humano; los roles del ciclo no ejecutan `plan`)**.

### De documentación

1. `docs/integracion/para-backend.md` recoge: qué identificadores recibe el backend y cómo (nombres, nunca valores), qué debe cambiar el backend (validar tokens de Cognito por claves públicas del emisor, aceptar durante la transición tanto el token propio como el de Cognito, retirar `POST /log`, `JWT_SECRET`, `ADMIN_*` al final), el contrato de entorno actualizado (tabla de la sección 2 con `EMAIL_PASSWORD` de vuelta en `app_env_vars` y el estado de `JWT_SECRET` y `ADMIN_PASSWORD` según la decisión 1) y el orden de despliegue.
2. `docs/integracion/para-frontend.md` recoge: qué identificadores y direcciones de retorno publica la infraestructura para el flujo de login, cómo llegan al frontend (variables `VITE_*` inyectadas por infra, decisión 6), qué debe cambiar el frontend (login, almacenamiento y envío del token, gestión de expiración) y el mismo orden de despliegue.
3. Orden de despliegue documentado, con quién hace cada paso: (1) infra aplica en `dev` y luego `prod`, (2) backend despliega aceptando ambos tokens durante un tiempo, (3) frontend despliega con el login nuevo, (4) se retira el login antiguo (backend, y después infra con los secretos que sobren). Debe indicar qué comprobar entre pasos y cómo volver atrás.
4. `docs/referencia-modulos.md` (variables, outputs, claves de `app_env_vars` y secciones de Parameter Store) refleja el código; `docs/guias/seguridad.md` (SEG-2, SEG-4) deja de afirmar que `EMAIL_PASSWORD` viaja por Parameter Store y recoge el control nuevo de identidad.
5. `docs/estado-y-deuda-tecnica.md` se pone al día con fecha de hoy (S2 y S6 cambian de alcance; hallazgo o iteración nueva; métricas), y se marca como **(por confirmar)** todo lo que dependa de la cuenta real de AWS.
6. Si afecta a `README.md` o a las plantillas de PR y CI, quedan coherentes (`docs-check` lo comprueba). Se redacta el aviso de PR con la sección "Frontend y backend".

## Fuera de alcance

- Cambios de código en `sigmetum-backend` y `sigmetum-frontend`: solo se documentan como tareas en los contratos.
- Revisar o mover el correo (`EMAIL`, `EMAIL_PASSWORD`, SMTP): se revisará después (decisión del usuario).
- Rotación de los secretos existentes y limpieza de versiones antiguas del estado (S2): sigue como seguimiento aparte.
- Crear usuarios reales, contraseñas temporales o cualquier valor secreto: nunca en el repositorio ni en documentos.
- Migrar a otros proveedores de identidad o federación externa (Google, SAML...), salvo que las decisiones 2 o 4 lo pidan.
- `terraform apply`, `plan`, `import` o comandos de AWS que cambien recursos: los ejecuta el humano.

## Impacto en contratos externos

- `docs/integracion/para-backend.md`: **lo afecta** (alto). Cambia el contrato de entorno (`EMAIL_PASSWORD` de vuelta a `app_env_vars`; `JWT_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` según la decisión 1; posibles claves nuevas no secretas), la validación de tokens, el orden de despliegue y el procedimiento de Parameter Store (revisar secciones 2, 5 y 10). Contrastar con `config/validateEnv.js` del backend, que hoy exige las nueve variables y reglas de valor para `JWT_SECRET` y `ADMIN_PASSWORD`.
- `docs/integracion/para-frontend.md`: **lo afecta** (alto). Nuevos datos de login (identificadores, direcciones de retorno según el entorno), posible variable `VITE_*` nueva (cambiarla exige compilación nueva), cabeceras (la CSP en modo solo informe debe contemplar el origen del servicio de identidad si se usa el flujo alojado o llamadas directas) y orden de despliegue (secciones 2, 3 y 4).
- Dependencia con el dominio: en `dev` la URL de Amplify solo se conoce tras crear la app; en `prod` el dominio es fijo (apex y `www`, infra:C9). Las direcciones de retorno deben ser coherentes con `ALLOWED_ORIGIN` de cada entorno.

## Decisiones del usuario (31/10/2026)

1. **Transición, `JWT_SECRET` y `ADMIN_*` (opción b):** se devuelven a `app_env_vars` (`tfvars`) ya, junto con `EMAIL_PASSWORD`, y se retira por completo la maquinaria de Parameter Store del commit `0885804` en esta iteración (política IAM `sigmetum-ssm-secrets-<env>`, espacio de nombres `environmentsecrets`, `validation` que rechaza las tres claves, sección de la referencia y comprobaciones de `quality-check`/`docs-check`). Como nunca se aplicó, no hay parámetros que borrar en AWS. S2 y S6 vuelven a abiertos con alcance reducido hasta que el backend retire el login antiguo. Al final de la transición se quitan `JWT_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
2. **Interfaz de login:** Hosted UI de Cognito con código de autorización y PKCE; cliente sin secreto. Hace falta dominio del grupo de usuarios (prefijo de Cognito; dominio propio queda fuera salvo que el architect lo exija) y ajustar la CSP del frontend.
3. **Direcciones de retorno y cierre de sesión:** se derivan de los outputs de `modules/amplify` (dominio por defecto de Amplify en `dev`, `custom_domains` en `prod`). **Sin `localhost`**, tampoco en `dev`. El architect resuelve el orden de `apply` y la dependencia con `ALLOWED_ORIGIN`.
4. **Administrador y MFA:** alta a mano por una persona, con procedimiento documentado; la contraseña temporal nunca pasa por Terraform ni por el repositorio. **MFA TOTP obligatorio.** Sin registro público. Dos administradores (uno habitual y uno de emergencia, otra persona, otro correo, TOTP propio), sin grupos ni roles por ahora: cualquier usuario del pool es administrador (C16).
5. **Duración de la transición:** **plazo fijo (por ejemplo, dos semanas)**, que fijará el humano al desplegar y se anota como deuda con su id. Duración de los tokens de Cognito y renovación: propuesta del architect, por confirmar.
6. **Identificadores:** los inyecta infra: variables `VITE_*` nuevas en Amplify (frontend, compilación nueva) y claves nuevas no secretas en `app_env_vars` (backend, que debe añadirlas a `validateEnv.js`), derivadas de los outputs de Cognito.

## Preguntas abiertas

Ninguna.
