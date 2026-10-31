# Aviso para PR: ajustes de integración con frontend y backend

Fecha: 30/10/2026 · Cambio **crítico** (contrato con el frontend) · Spec: [design](2026-10-30-ajustes-integracion-frontend-backend-design.md) · Plan: [plan](2026-10-30-ajustes-integracion-frontend-backend-plan.md)

## Qué cambia

- `environments/prod/main.tf`: `s3_url = module.storage.cdn_url` (antes vacío). `VITE_S3_URL` de `prod` pasa a ser la URL de CloudFront.
- `modules/amplify/main.tf` (`build_spec`): `preBuild` fija Node 22 con `nvm install 22 && nvm use 22`, ejecuta `npm ci` y después `npm test`. Si `npm test` falla, Amplify no despliega. Sin cambios en `build`, `artifacts`, `cache`, `custom_rule`, otras `VITE_*` ni `app_env_vars`.

## Frontend: qué debe hacer

1. Node 22 es una decisión de infra: actualizar su `docs/integracion/para-infra.md` (sección 2, hoy "Node 20 o superior" y `nvm use 20`) a Node 22, y fijar `engines`/versión mínima (`package.json` no tiene `engines`).
2. Comprobar que `npm test` no necesita red ni secretos y que no queda en modo watch.
3. Preparar la migración a Node 24; infra cambiará el `build_spec` entonces y avisará.
4. Tener en cuenta que `prod` dará 403/404 en favicon y logos hasta resolver C7 (subida de `assets/…`); infra avisará.

## Backend: qué debe hacer

Ninguna acción de código en este cambio: no cambian `app_env_vars`, IAM ni health check. `TRUST_PROXY_HOPS` sigue sin fijarse (`backend:I7`), y el backend lo marca como **obligatorio antes de desplegar la entrega 2 de M21** (`POST /send-email` pública), según su `docs/integracion/para-infra.md` (sección 6, límite de `POST /send-email`, y fila I7 de las discrepancias): infra debe medir los saltos y fijarla antes de ese despliegue; el backend no debe desplegar esa entrega hasta entonces. La validación estricta de `validateEnv` impide arrancar con valores incumplidores fuera de `local` y `test` **(por confirmar)** con los valores reales.

## Orden de despliegue

1. Infra, lo ejecuta el humano: `terraform apply` en `dev`, comprobar el build de Amplify (Node 22 con `nvm`), y después en `prod`.
2. Frontend: una compilación nueva (los valores `VITE_*` están incrustados).

## Por confirmar

- Que la imagen de Amplify traiga Node 22 o que `nvm install 22` funcione en el build, y que `nvm use` persista entre comandos de `preBuild`.
- Efecto en el Amplify desplegado (no se ha ejecutado `plan` ni `apply`).

Integración: documentos afectados `docs/integracion/para-frontend.md` (crítico) y `docs/integracion/para-backend.md` (solo documental).
