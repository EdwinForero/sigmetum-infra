# Ajustes de integración con frontend y backend: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

Dos ajustes de código (`s3_url` de `prod` y `build_spec` de Amplify, C10) y la puesta al día de los documentos de integración y de estado, que ya no coinciden con el código de Terraform ni con los documentos `para-infra.md` del frontend y del backend. Los abiertos `backend:I7`, C7, C9 y C11 siguen abiertos.

## Decisiones registradas

1. Node: el `build_spec` fija **Node 22** (no 20) en `preBuild`, con `nvm install 22 && nvm use 22`, para no depender de que la imagen lo traiga. Intención declarada: migrar a **Node 24** más adelante. La preinstalación de Node 22 en la imagen de Amplify sigue **(por confirmar)**.
2. `npm test` va en `preBuild`, justo después de `npm ci`.
3. Se acepta que `prod` dé 403/404 en favicon y logos hasta resolver C7 y avisar al frontend.
4. El id de `TRUST_PROXY_HOPS` es `backend:I7` (con prefijo de repositorio); no se usa `I7` a secas.
5. Se limpian en este mismo cambio los duplicados de C4 y C8 en "Resueltos" de `docs/estado-y-deuda-tecnica.md`.

## Criterios de aceptación

### De código

Cambio **crítico** (el punto 2 modifica un contrato con el frontend).

1. `environments/prod/main.tf` pasa `s3_url = module.storage.cdn_url` al módulo `amplify` y desaparece el comentario "until C2". Observación: `grep "until C2" environments/prod/main.tf` no devuelve nada.
2. El `build_spec` de `modules/amplify` fija Node 22 en `preBuild` con `nvm install 22 && nvm use 22`, ejecuta `npm test` en `preBuild` justo después de `npm ci`, y sigue ejecutando `npm run build` en `build`, sin cambiar `artifacts` (`dist`, `**/*`) ni `cache`. Observación: leer el bloque `build_spec`.
3. Ninguna variable `VITE_*`, `app_env_vars`, regla `custom_rule` ni `.tfvars.example` cambia (`git diff --stat` no los muestra).
4. Pasan `terraform fmt -check -recursive`, `terraform validate` en `dev` y `prod`, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs`.
5. Sin secretos ni ARN en ningún archivo tocado; ningún `apply`, `plan`, `import` ni `state`.

### De documentación

1. `docs/estado-y-deuda-tecnica.md`:
   - "Última actualización: 30/10/2026" (formato `DD/MM/AAAA`).
   - C10 pasa de Abiertos a Resueltos (si el ajuste de código se hace), con "(por confirmar)" para el efecto en el Amplify desplegado.
   - C2, C4 y C8 constan una sola vez en "Resueltos" (se eliminan los duplicados de C4 y C8).
   - C12 deja de decir `index.js`: el `trust proxy` está hoy en `app.js` y lo fija `TRUST_PROXY_HOPS`.
   - Se añade `backend:I7` como abierto: medir saltos de proxy y fijar `TRUST_PROXY_HOPS` en `app_env_vars`. No se confunde con `frontend:I7` (= C7).
   - C7, C9, C11 y `backend:I7` constan como abiertos. C7 se anota además con el efecto aceptado: `prod` da 403/404 en favicon y logos hasta resolverlo y avisar al frontend.
   - Las métricas no cambian.
2. `docs/integracion/para-frontend.md`:
   - Sección 1: C2 y C8 pasan a Resuelto, C4 refleja CloudFront (hoy dice "aplazado"), C10 según el resultado del código; C7, C9 y C11 siguen Abiertos.
   - Sección 2: `build_spec` actualizado con Node 22 y `npm test`; `VITE_S3_URL` y `VITE_CAROUSEL_IMAGE_KEYS` sin "vacío hasta resolver C2" (CloudFront de `storage`, en `prod` también); recursos estáticos y `branch_url` (con `replace("/", "-")`) corregidos.
   - "Reglas de reescritura": las dos `custom_rule` reales (paso de `/assets/<*>` y regex SPA `</^((?!\.).)+$>` a `/index.html`), no la `/<*>` actual.
   - Sección 3 (necesidades) deja de decir que `npm test` y la versión de Node no están.
   - Tarea anotada para el frontend: el build usa Node 22; el frontend debe ajustar su documentación y `engines`/versión mínima (hoy dice Node 20 o superior) y preparar la migración a Node 24. Infra cambiará el `build_spec` en ese momento y avisará.
   - Riesgo anotado: hasta resolver C7, `prod` da 403/404 en favicon y logos.
3. `docs/integracion/para-backend.md`:
   - Sección 1 y 8: B1 y C12 con `trust proxy` en `app.js` y la variable opcional `TRUST_PROXY_HOPS` (por defecto 1); `backend:I7` abierto (infra mide saltos y la fija en `app_env_vars`).
   - Sección 2: `validateEnv` estricto (M15): `JWT_SECRET` >= 32, `ADMIN_PASSWORD` hash bcrypt, `JWT_EXPIRATION` con unidad, `NODE_ENV` distinto de `local`/`test` en Beanstalk; solo nombres y reglas, sin valores.
   - Sección 5: prefijos `data/drafts/` y `data/terms/` además de `gallery/`, `data/` y `data/active/`; la política IAM ya cubre el bucket (sin cambio de permisos).
   - Sección 6: `engines.node` ya fijado (B3, hoy el documento dice que no); el job `verify` del CI del backend ejecuta `npm test` y `npm audit`.
   - Fechas y commit de la verificación al día.
4. Todo lo que no se pueda comprobar en AWS ni en el entorno desplegado queda como **(por confirmar)**, y cada afirmación sobre el backend o el frontend se contrasta con su código o su `para-infra.md` antes de escribirla.

## Fuera de alcance

- `app_env_vars` (no se añade `TRUST_PROXY_HOPS`) y los `.tfvars.example`.
- Resolver `backend:I7`, C7, C9 y C11.
- Medir saltos de proxy o cualquier acción en AWS.
- Cambios en `modules/storage` (S7: limitar IAM por prefijo) y en `modules/amplify` distintos del `build_spec`.
- Migrar a Node 24 (solo se deja anotada la intención).
- Editar documentos de los repositorios hermanos.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta, **crítico**. Cambia el `build_spec` (Node 22 y `npm test`: si los tests fallan, Amplify no despliega) y `VITE_S3_URL` de `prod` (pasa de vacío a la URL de CloudFront, lo que exige una compilación nueva y activa el favicon). Qué debe hacer el frontend:
  - Ajustar su documentación y `engines`/versión mínima a Node 22 (hoy dice Node 20 o superior).
  - Preparar la migración a Node 24; infra cambiará entonces el `build_spec` y avisará.
  - Tener en cuenta que `prod` dará 403/404 en favicon y logos hasta que se resuelva C7 (subida de `assets/…`); infra avisará al resolverlo.
  - Orden de despliegue: primero infra (Terraform), después una compilación nueva del frontend.
- `docs/integracion/para-backend.md`: solo documental; no cambia `app_env_vars`, IAM ni health check. El backend debe saber que `TRUST_PROXY_HOPS` sigue sin fijarse (`backend:I7`) y que `validateEnv` estricto puede impedir el arranque con valores reales incumplidores (por confirmar).

## Riesgos

- Aceptado: `prod` sirve favicon y logos con 403/404 hasta resolver C7 y avisar al frontend.
- Si `npm test` falla, Amplify no despliega.
- Node 22 con nvm: si la imagen no lo trae, `nvm install 22` añade tiempo y requiere red en el build (por confirmar).

## Preguntas abiertas

Ninguna.
