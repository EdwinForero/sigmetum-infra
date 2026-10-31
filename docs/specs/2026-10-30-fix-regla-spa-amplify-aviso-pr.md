# Aviso para PR: regla de reescritura SPA de Amplify

Fecha: 30/10/2026 · Cambio **crítico** (contrato con el frontend) · Spec: [design](2026-10-30-fix-regla-spa-amplify-design.md) · Plan: [plan](2026-10-30-fix-regla-spa-amplify-plan.md)

## Qué cambia

- `modules/amplify/main.tf`: solo el `source` de la regla SPA (segunda `custom_rule`). Antes `</^((?!\.).)+$>`; ahora formato `</regex/>` con `^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|pdf)$)([^.]+$)`. Sin cambios en `target`, `status`, la regla `/assets/<*>`, `build_spec`, `VITE_*` ni `app_env_vars`.
- Hallazgo `infra:C14` (= `frontend:I3`, `backend:F16`): resuelto en código; comportamiento en el Amplify desplegado **(por confirmar)**.
- Se despliega en `dev` y `prod` a la vez (el módulo es el mismo).
- Terminología: la "preproducción" del frontend equivale a `dev` en infra.

## Frontend: qué debe hacer

1. Actualizar en su `docs/integracion/para-infra.md` la fila I3 de la sección 1 y su nota sobre preproducción (`dev` en infra): resuelto en código, pendiente del `apply` y de la comprobación.
2. Confirmar que ninguna ruta suya contiene un punto que ahora se reescriba a `index.html`, y que no usa extensiones fuera de la lista (límite conocido: `.avif`, `.mp4`, `.xml`, `.webmanifest` y extensiones en mayúsculas se reescriben a `index.html`).
3. Pedir a infra las extensiones nuevas que use; la lista queda tal cual hasta entonces.

## Backend: qué debe hacer

Actualizar la mención de F16 en su `docs/integracion/para-frontend.md` (hoy dice que falta aplicar la regla en preprod). Sin cambios de código: no cambian `app_env_vars`, IAM, health check ni ALB.

## Orden de despliegue

1. Infra, lo ejecuta el humano (ningún rol hace `apply`): `terraform apply` en `dev` y `prod` a la vez.
2. Comprobar en ambos entornos, en solo lectura:
   - `aws amplify get-app` con `--output text`: las dos reglas, `/assets/<*>` primero y la regex nueva después, con `/index.html` y `200`.
   - `curl -I` a `/explorar`, a `/explorar/` y a una ruta anidada: deben dar `200` con `index.html`. Probar las tres distingue si el `301` desaparece o solo cambia de código.
   - `/assets/<fichero con hash>` da `200` con el fichero, y `/algo.v2` da `200` con `index.html`.
3. Si `/explorar` sigue dando `301` o `404`, reabrir C14.

## Por confirmar

- La causa: que la `/` final que faltaba fuera el motivo. No está confirmada; el `301` a barra final podría ser comportamiento propio de Amplify, independiente de las reglas.
- Efecto en el Amplify desplegado de `dev` y `prod` (no se ha ejecutado `plan` ni `apply`).
- URL de `prod` para el `curl`: la de Amplify por defecto o el dominio (C9 sigue abierto).

Integración: `docs/integracion/para-frontend.md` actualizado (crítico). `docs/integracion/para-backend.md`: sin impacto, solo la mención de F16 en el documento del backend.
