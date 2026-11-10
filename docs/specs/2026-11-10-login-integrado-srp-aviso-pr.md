# Aviso para PR: login de administrador integrado en la página (SRP)

Fecha: 10/11/2026 · Cambio **crítico** (contrato con el frontend: variables `VITE_*` y CSP de Amplify; cliente del pool de Cognito) · Decisión del usuario del 10/11/2026 (hallazgo `C18`).

## Qué cambia

- `modules/cognito/main.tf`: el cliente del pool pasa de `ALLOW_REFRESH_TOKEN_AUTH` a `ALLOW_USER_SRP_AUTH` y `ALLOW_REFRESH_TOKEN_AUTH`. **Siguen sin habilitarse** `ALLOW_USER_PASSWORD_AUTH` y `ALLOW_ADMIN_USER_PASSWORD_AUTH` (`quality-check` falla si aparecen). El Hosted UI y las direcciones de retorno no cambian: queda como respaldo.
- `modules/amplify`: variable nueva `cognito_user_pool_id` e inyección de `VITE_COGNITO_USER_POOL_ID` **solo en la rama** (igual que `VITE_COGNITO_CLIENT_ID`); el `connect-src` de la CSP Report-Only añade `https://cognito-idp.<región>.amazonaws.com` cuando hay Cognito configurado.
- `environments/dev` y `environments/prod`: pasan `module.cognito.user_pool_id` a `module.amplify`.
- `scripts/quality-check.mjs`: solo cambia el texto del mensaje de la regla de flujos de contraseña (la regla es la misma).
- `docs/guias/seguridad.md` (SEG-13) revisada con la decisión: pantalla de login propia, riesgos nuevos y qué sigue prohibido.
- Motivo: el Hosted UI es una página alojada por AWS y no se puede incrustar; con el formulario propio el frontend habla con la API de Cognito por SRP (la contraseña no viaja en claro).

## Qué mira el humano en `terraform plan` (dev; no pegar la salida)

1. Cambio en sitio (`~`) de `aws_cognito_user_pool_client.this` (solo `explicit_auth_flows`; **sin `replace`**: si el cliente se reemplazara, cambiaría `VITE_COGNITO_CLIENT_ID`; parar y revisar).
2. Cambio en sitio de `aws_amplify_app.this` (la CSP) y de `aws_amplify_branch.this` (una variable `VITE_COGNITO_USER_POOL_ID` nueva).
3. Sin `destroy`, sin `replace`, nada en Beanstalk, S3 ni DNS. En `prod`, el mismo cambio en código, sin aplicar todavía.

## Orden de despliegue

1. Humano: `plan` y `apply` en `dev` (cuenta `sigmetum-preprod`).
2. Frontend: implementar el formulario propio (contrato en [para-frontend.md](../integracion/para-frontend.md#login-con-cognito-formulario-propio)) y añadir `VITE_COGNITO_USER_POOL_ID` a su `.env.example`.
3. Antes o después: dar de alta a los dos administradores ([cognito-administradores.md](../cognito-administradores.md)).
4. Compilación nueva del frontend en `dev` (los `VITE_*` van incrustados) y prueba del flujo completo.
5. `prod`: no se toca hasta `S18-prod`.

## Frontend y backend

- **Frontend (debe actuar):** sustituir el botón del Hosted UI por un formulario con SRP, los retos `NEW_PASSWORD_REQUIRED`, `MFA_SETUP` (con QR) y `SOFTWARE_TOKEN_MFA`, y el cierre y la renovación de sesión descritos en el contrato; añadir `VITE_COGNITO_USER_POOL_ID` a su `.env.example` (mientras no esté, `docs-check --strict` y `quality-check` avisan) y revisar los avisos de la CSP.
- **Backend: no cambia.** Recibe el mismo token de acceso y valida lo mismo.
- **Documentación desactualizada de los dos repositorios (`C19`):** informativo; el detalle está en `docs/estado-y-deuda-tecnica.md`.

## Documentos de integración

`docs/integracion/para-frontend.md` (contrato de login reescrito, filas `C18` y `C19`, tareas y orden), `docs/integracion/para-backend.md` (una nota: sin cambios para el backend), `docs/referencia-modulos.md` (variable, `VITE_*` y cliente), `docs/guias/seguridad.md`, `docs/guias/mantenimiento.md`, `docs/cognito-administradores.md` y el README.

## Por confirmar

- `plan` y `apply` en `dev`, y que el cliente se actualice en sitio.
- El flujo completo con SRP contra el pool real, el orden de los retos del primer acceso y el bloqueo por intentos fallidos.
- Si el Hosted UI se retira más adelante (decisión pendiente).
