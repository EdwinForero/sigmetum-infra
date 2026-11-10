# Aviso para PR: Cognito en corte único (retirar el login antiguo del contrato de infraestructura)

Fecha: 2026-11-03 · Spec: `docs/specs/2026-10-31-cognito-corte-unico-design.md` · Plan: `docs/specs/2026-10-31-cognito-corte-unico-plan.md`

Crítico: sí (secretos y `terraform.tfvars`; contrato con el frontend y el backend). Solo marcadores y nombres de claves; ningún valor.

Integración: sí hay impacto: se actualizan `docs/integracion/para-backend.md` (secciones 1, 2 y 10) y `docs/integracion/para-frontend.md` (orden de despliegue y tarea de login).

## Qué cambia

- `modules/beanstalk/variables.tf`: la `validation` de `app_env_vars` exige seis claves (`EMAIL`, `EMAIL_PASSWORD`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN` y `COGNITO_USER_POOL_ID`) y acepta claves extra; deja de mencionar `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
- Plantillas `environments/{dev,prod}/terraform.tfvars.example`: sin esas cuatro claves; `EMAIL_PASSWORD` sigue como marcador. La de prod lleva un aviso de no copiarla sobre un `terraform.tfvars` en uso.
- `scripts/quality-check.mjs`: regla nueva que **falla** si esas cuatro claves reaparecen en las plantillas (también comentadas). No lee `terraform.tfvars`.
- Documentación: referencia, README, estado y deuda técnica (S2, S6 y S18), los dos documentos de integración y notas «Modificado por» en la spec y el plan de `cognito-login`. Guías actualizadas con autorización expresa del usuario para este ciclo: `seguridad.md`, `mantenimiento.md` y `buenas-practicas-terraform.md`.
- Prod no cambia: su `terraform.tfvars` real puede conservar las cuatro claves (la `validation` las acepta como extras) hasta su corte propio (`S18-prod`).

## Avisos para quien revisa (leer antes de aprobar)

1. **El backend solo-Cognito no existe todavía** en `sigmetum-backend` (**por confirmar**): su `validateEnv.js` sigue exigiendo las cuatro claves. Aplicar infra antes de desplegar el backend nuevo deja a dev sin arrancar.
2. **Riesgo de `AllAtOnce` en dev** (`modules/beanstalk/main.tf`): el `apply` reinicia el backend con la versión vieja, que exige las cuatro claves y no arranca. Beanstalk podría marcar la actualización como fallida y revertir, o el `apply` tardar. **Mitigación:** subir antes a S3 la versión del backend nuevo, desplegarla justo tras el `apply` y comprobar con `describe-events` si hubo rollback. El `apply` de dev debe ser el que crea el pool, para que `COGNITO_USER_POOL_ID` esté disponible para el backend nuevo.
3. **Sin vuelta atrás en dev** (decisión del usuario): se arregla hacia delante. La vuelta atrás de prod no está decidida; se define en `S18-prod`.
4. **S6 casi cerrado en dev, abierto en prod.** En dev solo `EMAIL_PASSWORD` viaja como propiedad de entorno; prod conserva las claves antiguas hasta su corte. C16 no cambia.
5. **Avisos de coherencia y `--strict`.** Hasta que el backend cambie, `quality-check` y `docs-check` dan avisos («el backend exige X y la plantilla no la define»); `docs-check --strict` no puede pasar (**por confirmar** cuando cambie el backend). La CI no usa `--strict`. No se limpian hasta entonces.
6. **Por confirmar:** el `plan` humano de dev muestra solo el cambio de propiedades de entorno de Beanstalk, sin reemplazos ni destrucciones; el `plan` de prod no cambia. Los roles del ciclo no ejecutan `plan`.

## Frontend y backend

- Afecta al contrato con el frontend y con el backend: **sí**.
- **Backend:** retirar `POST /log`, `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` de `config/validateEnv.js`, el verificador HS256 y la ruta de login; dejar un único verificador de Cognito; añadir `COGNITO_USER_POOL_ID` a `required` (entonces la fila de la referencia pasa a «Sí» y `docs-check` lo avisará).
- **Frontend:** el login pasa a ser un reemplazo sin convivencia de tokens; el login antiguo deja de funcionar al desplegar el backend. Se despliega después, con las `VITE_COGNITO_*`.
- **Infra (humano):** `apply` de dev sin las cuatro claves.
- **Orden en dev:** (1) backend solo-Cognito listo; (2) `apply` de infra y despliegue inmediato del backend, seguidos (caída de unos minutos aceptada); (3) crear los dos administradores y verificar el TOTP; (4) frontend. Entre pasos, solo lectura: Beanstalk en `Green`, `/healthcheck` en `200`, Hosted UI cargando, administradores en `CONFIRMED` con MFA.
- **Prod:** sin tocar hasta verificar el TOTP en prod con los dos administradores.
