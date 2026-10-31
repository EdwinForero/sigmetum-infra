# Ajustes de integración con frontend y backend: plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-ajustes-integracion-frontend-backend-design.md`

Crítico: sí (entrada de `criticidad`: contrato con el frontend y el backend, `build_spec`; el paso 1 cambia `VITE_S3_URL` de `prod`).

## Fase 1

1. **`s3_url` de `prod` apunta a CloudFront**
   - Archivos exactos: `environments/prod/main.tf` (modificar).
   - Firmas que cambian: en `module "amplify"`, se quitan el comentario "until C2" y `s3_url = ""` y se pone `s3_url = module.storage.cdn_url`, con el `=` alineado como en `environments/dev/main.tf:47`. `module.storage.cdn_url` existe (`modules/storage/outputs.tf`). Sin variables ni outputs nuevos.
   - Comprobación: `grep "until C2" environments/prod/main.tf` no devuelve nada; pasan `terraform fmt -check -recursive` y `terraform validate` en `environments/prod`.
   - Norma o contrato: `docs/integracion/para-frontend.md` sección 2 (`VITE_S3_URL`); `docs/guias/buenas-practicas-terraform.md` (contrato con el frontend).

2. **`build_spec` con Node 22 y `npm test`**
   - Archivos exactos: `modules/amplify/main.tf` (modificar solo el heredoc `build_spec`).
   - Firmas que cambian: `preBuild.commands`, en este orden: `nvm install 22 && nvm use 22`, `npm ci`, `npm test`. Sin cambios: `build` (`npm run build`), `artifacts` (`dist`, `'**/*'`), `cache`, los `custom_rule` y las `VITE_*`. Indentación de 4 espacios del heredoc `<<-EOT`.
   - Comprobación: leer el bloque `build_spec`; `git diff --stat` solo muestra `environments/prod/main.tf` y `modules/amplify/main.tf` (más documentos); pasan `fmt`, `validate` en `dev` y `prod`, `quality-check` y `docs-check`.
   - Norma o contrato: `docs/integracion/para-frontend.md` secciones 2 y 3; `docs/guias/mantenimiento.md` sección 3 (lista de Amplify). Si `npm test` falla, Amplify no despliega.
   - Alternativas descartadas: `npm test` en `build`; `.nvmrc` (pertenece al frontend). Que `nvm use` persista entre comandos de la misma fase es **(por confirmar)**.

## A cargo del tester-documentador

Contrasta cada afirmación con el código antes de escribirla; lo que dependa de AWS va como **(por confirmar)**.

**A. `docs/estado-y-deuda-tecnica.md`**
- "Última actualización: 30/10/2026"; reescribir el commit base y la línea "Ningún `.tf` se ha modificado" (ahora se tocan dos).
- C10 a Resueltos (Node 22 con `nvm` y `npm test` en `preBuild`); por confirmar: efecto en el Amplify desplegado, Node 22 en la imagen, y que hace falta `apply` y una compilación nueva. Anotar la intención de migrar a Node 24.
- Resueltos: quitar los duplicados de C4 y C8; C2, C4 y C8 una sola vez; C2 debe decir que `prod` también usa `module.storage.cdn_url`.
- C12: `index.js` pasa a `app.js`, con `trust proxy` fijado por `TRUST_PROXY_HOPS` (1 si no se define); contrastar con `app.js` del backend.
- Añadir `backend:I7` como abierto (medir saltos de proxy y fijar `TRUST_PROXY_HOPS` en `app_env_vars`; responsable infra y backend), sin confundirlo con `frontend:I7` (= C7).
- C7: añadir el efecto aceptado (`prod` da 403/404 en favicon y logos hasta resolverlo y avisar al frontend). C7, C9, C11 y `backend:I7` siguen abiertos.
- Fila nueva en "Iteraciones". Las métricas no cambian; `docs-check --metrics` debe seguir pasando.
- M4 dice que `terraform fmt` falla en `prod/main.tf`: tras el paso 1, ejecutar `fmt -check`; si ya pasa, decir que la entrada está obsoleta, sin borrarla en silencio.

**B. `docs/integracion/para-frontend.md`**
- Cabecera: fecha 30/10/2026 y rama.
- Sección 1: C2, C8 y C10 a Resuelto; C4 refleja CloudFront (`enable_cdn`, `backend_url = module.beanstalk.backend_cdn_url`); C7, C9 y C11 abiertos.
- Sección 2: `build_spec` actualizado (sin la nota de C10); variables sin "vacío hasta resolver C2" (`s3_url` es CloudFront en `dev` y `prod`); las dos `custom_rule` reales (`/assets/<*>` a `/assets/<*>` con 200, y `</^((?!\.).)+$>` a `/index.html` con 200) en lugar de `/<*>`; `branch_url` con `replace("/", "-")`; recursos estáticos con CloudFront y OAC, sin subir aún (C7).
- Sección 3: quitar "no fija versión" y "no está hoy"; anotar el riesgo de 403/404 en `prod` hasta resolver C7.
- Tarea para el frontend: el build usa Node 22; ajustar su documentación (hoy "Node 20 o superior") y `engines`/versión mínima, y preparar la migración a Node 24 (infra cambiará el `build_spec` y avisará).
- Orden: primero `terraform apply` en `prod`, hecho por el humano; después una compilación nueva del frontend.

**C. `docs/integracion/para-backend.md`**
- Cabecera y sección 11: `index.js` pasa a `app.js`; fechas y commit de la verificación al día.
- Secciones 1, 4 y 8: `trust proxy` en `app.js` con `TRUST_PROXY_HOPS` (opcional, 1 si no se define; entero de 1 a 5; el 0 solo con `NODE_ENV` `local` o `test`); `backend:I7` abierto.
- Sección 3: ubicación real del health check; verificar en qué fichero vive hoy la función CORS de la sección 7 antes de citarla.
- Sección 2: `validateEnv` estricto (M15), solo nombres y reglas: `JWT_SECRET` de al menos 32 caracteres, `ADMIN_PASSWORD` hash bcrypt, `JWT_EXPIRATION` con unidad y mayor que cero, `TRUST_PROXY_HOPS` válido; con `NODE_ENV` distinto de `local` y `test`, un valor inválido impide el arranque; no definir `NODE_ENV` como `local` ni `test` en Beanstalk. Los valores reales son **(por confirmar)**; no se leen.
- Sección 5: prefijos `gallery/`, `data/`, `data/active/`, `data/terms/`, `data/drafts/`; la política IAM cubre todo el bucket (S7/B2 abiertos); sin cambio de permisos.
- Sección 6: `engines.node` es `"22"` en `package.json` (la sección 8 dice `"22.x"`: corregir); el job `verify` del CI del backend ejecuta lint, quality, docs:check, `npm test` y `npm audit --audit-level=high`; actualizar también la sección 9.
- Aviso al backend: `TRUST_PROXY_HOPS` sigue sin fijarse (`backend:I7`).

**E. Decisión del usuario en la puerta del plan (aprobada)**
- Corregir `docs/guias/seguridad.md` (líneas 66 y 137 y donde más aparezca): hay CloudFront con OAC delante del bucket; contrastar con `modules/storage/main.tf` antes de escribir.
- Anotar el alcance de CloudFront (la política del bucket da `s3:GetObject` sobre todo el bucket y la distribución no filtra por prefijo) como deuda abierta **(por confirmar)** en `docs/estado-y-deuda-tecnica.md`, con un id nuevo; en `KNOWN_DEBT` solo si `quality-check` lo exige. Sin tocar `modules/storage`.
- Anotar en `para-frontend.md` las dos comprobaciones previas del frontend: que `npm test` no necesita red ni secretos y que no queda en modo watch.
- Orden recomendado para el humano: `apply` primero en `dev` y comprobar el build de Amplify (Node 22 con nvm); después `prod`.

**D. Hallazgos fuera de la spec (resueltos en la puerta: ver E)**
1. `docs/guias/seguridad.md` (líneas 66 y 137) sigue diciendo que no hay CloudFront y "Recursos públicos accesibles: No (C2)": contradice el código. Fuera del alcance de la spec.
2. La política `AllowCloudFrontOAC` de `modules/storage/main.tf` da `s3:GetObject` sobre todo el bucket y la distribución no filtra por prefijo: CloudFront puede servir también `data/` y `gallery/`, no solo `assets/*`. Posible deuda nueva (por confirmar). Requiere spec nueva si se toca `modules/storage`.

## Pruebas

- Sin pruebas nuevas (no se toca `plugins/`). Verificación: `terraform fmt -check -recursive`, `terraform validate` en `environments/dev` y `environments/prod`, `node scripts/quality-check.mjs`, `node scripts/docs-check.mjs` y, antes del commit, `node plugins/ciclo-agentico/scripts/docs-gate.mjs`.
- `docs-gate` exigirá `docs/referencia-modulos.md` y `README.md` por tocar `modules/amplify/**` y `environments/**`; el tester decide si basta una línea sobre Node 22 y `npm test`.
- Sin `plan`, `apply`, `import` ni `state`.

## Cierre

- Documentos de `integracion` afectados: `para-frontend.md` (crítico) y `para-backend.md` (solo documental).
- Despliegue: primero infra (Terraform, lo ejecuta el humano), después una compilación nueva del frontend. Frontend: Node 22 en su documentación y `engines`, preparar Node 24 y tener en cuenta el 403/404 de `prod` hasta resolver C7. Backend: ninguna acción; `TRUST_PROXY_HOPS` sigue sin fijarse (`backend:I7`).
