# Cognito en corte único: retirar el login antiguo del contrato de infraestructura (adelanta S18): spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

El usuario adelanta S18 (decisión del 31/10/2026): el backend migra ya a Cognito y se salta la transición con doble token. Infraestructura debe dejar de exigir y de documentar `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` en `app_env_vars`. El contrato queda con `EMAIL`, `AWS_REGION`, `AWS_BUCKET_NAME` y `ALLOWED_ORIGIN` (más `PORT` y `TRUST_PROXY_HOPS` opcionales), el único secreto `EMAIL_PASSWORD` y `COGNITO_USER_POOL_ID` inyectada por Terraform.

Esto modifica la spec cerrada `2026-10-31-cognito-login-design.md` (y su plan, commit `164830b`) en lo que dependía de la transición. Se aplica solo a `dev`; `prod` no se toca (condición de S18, ver "Decisiones").

Estado real del backend contrastado hoy (`../sigmetum-backend`, rama actual): `config/validateEnv.js` sigue exigiendo las cuatro claves (con reglas de valor para `JWT_SECRET` y `ADMIN_PASSWORD`), `routes/auth.js` sigue firmando JWT HS256 con `JWT_SECRET` y `middleware/tokenAuthentication.js` solo verifica HS256. Es decir, **el backend solo-Cognito aún no existe en ese repositorio**: es una dependencia externa de esta tarea, no comprobable desde infra **(por confirmar)**.

Supuestos (declarados, sin confirmar):

- El backend solo-Cognito se despliega inmediatamente después de aplicar infra en `dev` (decisión 1).
- Ni `dev` ni `prod` tienen hoy datos que dependan del login antiguo (los tokens emitidos dejan de ser válidos en el corte).

## Qué cambia respecto a la spec de Cognito (`2026-10-31-cognito-login-design.md`)

- **Decisión 1** (las tres claves vuelven a `app_env_vars` durante la transición): queda sustituida. Se mantiene `EMAIL_PASSWORD` en `app_env_vars`; se retiran `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` y además `JWT_EXPIRATION`, que esa spec no contemplaba retirar como secreto.
- **Decisión 5** (transición de plazo fijo, de dos semanas): desaparece para `dev`. Para `prod` el plazo deja de aplicarse como transición de doble token; queda solo la condición de verificar el TOTP.
- **Decisión 10 / orden de despliegue** (criterio de documentación 3: infra, backend con ambos tokens, frontend, retirada): se sustituye por un corte único en `dev` y un procedimiento propio para `prod`.
- **Criterio de código 7** (ningún cambio puede dejar al backend sin las claves mientras las exija): pasa a ser una restricción de orden de despliegue (decisión 7).
- **C16 y S18**: S18 se adelanta y se parte en `dev` (hecho aquí) y `prod` (pendiente de condición). C16 no cambia (decisión 9).
- Siguen igual: Hosted UI con PKCE, cliente sin secreto, MFA TOTP obligatorio, registro cerrado, dos administradores, variables `VITE_*`, `prevent_destroy` en `prod`.

## Criterios de aceptación

### De código

1. La `validation` de `app_env_vars` en `modules/beanstalk/variables.tf` exige `EMAIL`, `EMAIL_PASSWORD`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN` y `COGNITO_USER_POOL_ID`, y ya no menciona `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD` (ni en la condición ni en el mensaje ni en la descripción de la variable).
2. `terraform fmt -check -recursive` y `terraform validate` pasan en `environments/dev` y `environments/prod`.
3. Las plantillas `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example` no contienen las cuatro claves ni comentarios que las describan; `EMAIL_PASSWORD` sigue como marcador, nunca un valor. Ningún `.tf`, ejemplo ni script contiene un valor secreto.
4. Con las plantillas actualizadas, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` (también `--strict`) pasan; la comprobación de coherencia con `validateEnv.js` del backend no genera avisos nuevos inaceptables (depende del estado del backend en el momento de verificar; decisión 9).
5. `grep` de las cuatro claves en `*.tf`, `*.example` y `scripts/` solo devuelve usos justificados (p. ej. regla de `quality-check` que impida reintroducirlas, si se decide así).
6. El `plan` humano de `dev` solo muestra el cambio de propiedades de entorno de Beanstalk (cuatro quitadas); ningún reemplazo ni destrucción **(por confirmar, lo comprueba el humano; los roles del ciclo no ejecutan `plan`)**.
7. `prod` no cambia de comportamiento al aplicarse hoy: sus `app_env_vars` reales no se alteran (decisión 6: la `validation` común acepta las cuatro claves como extras).

### De documentación

1. `docs/referencia-modulos.md`: tabla de `app_env_vars` con las claves nuevas del contrato, sin las cuatro retiradas; ejemplo de `tfvars` coherente.
2. `docs/integracion/para-backend.md`: contrato de entorno actualizado; tarea del backend (retirar `POST /log`, `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_*` de `validateEnv.js`, verificador Cognito único); orden del corte en `dev` con qué comprobar entre pasos y cómo volver atrás; condición propia de `prod`.
3. `docs/integracion/para-frontend.md`: la tarea de login pasa a ser un reemplazo sin convivencia de tokens; se retira la mención a la transición. Orden de despliegue coherente con el de backend.
4. `docs/guias/seguridad.md`: SEG-2 y SEG-3 dejan de nombrar `JWT_SECRET` y `ADMIN_PASSWORD` como secretos vigentes y recogen `EMAIL_PASSWORD` como único secreto de `app_env_vars` (en `dev`; ver estado de `prod`).
5. `docs/estado-y-deuda-tecnica.md`, con "Última actualización: 31/10/2026": S2, S6 y S18 reflejan el nuevo alcance (cerrados o parciales para `dev`, abiertos para `prod`), C16 revisado, métricas al día y todo lo dependiente de la cuenta real marcado **(por confirmar)**.
6. Aviso de PR (`docs/specs/*-aviso-pr.md`) con la sección "Frontend y backend": orden de despliegue, caída de unos minutos en `dev`, y qué debe hacer cada repositorio. Otros textos con las claves (`README.md`, `docs/guias/mantenimiento.md`, `buenas-practicas-terraform.md`, diagramas HTML) coherentes o justificados como histórico; las specs anteriores no se reescriben.

## Fuera de alcance

- Cambios de código en `sigmetum-backend` y `sigmetum-frontend`: solo tareas documentadas.
- Tocar `prod` antes de verificar el TOTP en `prod` con los dos administradores (condición de S18).
- Revisar o mover el correo (`EMAIL`, `EMAIL_PASSWORD`, SMTP) y rotar secretos o limpiar versiones antiguas del estado (resto de S2).
- Validar `client_id` o grupos en el backend (vía de salida de C16), (decisión 9).
- `terraform apply`, `plan`, `import` o comandos de AWS que cambien recursos: los ejecuta el humano.

## Impacto en contratos externos

- `docs/integracion/para-backend.md`: **lo afecta** (alto). El contrato de entorno pierde cuatro claves obligatorias; el backend actual las exige al arrancar, así que desplegar infra sin ellas antes que el backend solo-Cognito lo deja sin arrancar. Cambia el orden de despliegue (corte único) y la tarea de retirar el login antiguo.
- `docs/integracion/para-frontend.md`: **lo afecta** (medio). Sin convivencia de tokens, el login por Hosted UI pasa a ser la única vía; el frontend actual (login antiguo) dejará de funcionar tras el corte en `dev`, hasta que despliegue el login nuevo.

## Decisiones del usuario (ya tomadas, no se reabren)

1. Corte único en `dev`: infra sin las cuatro claves y backend solo-Cognito desplegados seguidos, con unos minutos de caída aceptados.
2. `prod` no se toca hasta verificar el TOTP en `prod` con los dos administradores (condición de S18).
3. El `tfvars` de `dev` del usuario ya no tiene las cuatro claves.
4. Backend y frontend quedan fuera del repositorio: solo se documentan como tareas.
5. La spec de Cognito está cerrada y commiteada (`164830b`); esta tarea la modifica en lo indicado.
6. **`prod` y la `validation` común:** la `validation` de `modules/beanstalk` deja de exigir `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`, pero acepta que existan (claves extra permitidas). `prod` las conserva en su `tfvars` hasta su propio corte; `dev` no las tiene. Una sola `validation` para los dos entornos.
7. **Orden del corte en `dev`: corte único estricto.** Apply de infra sin las cuatro claves y despliegue inmediato del backend solo-Cognito; los dos administradores se crean y se verifica el TOTP **después** del corte, no antes. La caída dura hasta que backend y administradores estén listos, y no hay login antiguo de respaldo. El frontend de `dev` se despliega después del backend; el login antiguo del frontend actual deja de funcionar al desplegar el backend.
8. **Vuelta atrás en `dev`: ninguna, se arregla hacia delante** («todo de una, sin miedo»). No se exige copia privada de las cuatro claves ni rollback documentado para `dev`. La vuelta atrás de `prod` **no está decidida**: se define al preparar el corte de `prod` (S18-prod), que queda fuera de esta tarea.
9. **Scripts:** `quality-check` y `docs-check` siguen leyendo `required` de `validateEnv.js` del backend (avisan mientras el backend no cambie) y se añade en `quality-check` una regla que **falla** si las cuatro claves reaparecen en las plantillas `terraform.tfvars.example`. **C16 no cambia:** riesgo aceptado, cualquier usuario del pool sigue siendo administrador con el registro cerrado.

## Preguntas abiertas

Ninguna.
