# M2 reabierto, NODE_ENV en Amplify: plan

Fecha: 2026-10-31 · Estado: cerrado · Spec: `docs/specs/2026-10-31-m2-node-env-react-design.md`

Crítico: sí. Entrada de `criticidad`: «contrato con el frontend y el backend (VITE_*, build_spec, app_env_vars)». Cambia el conjunto de variables de entorno de compilación de Amplify y con él el bundle publicado; el `build_spec` y las `VITE_*` no cambian y no hay destrucción de recursos, pero el contrato con el frontend se ve afectado.

## Fase 1 (un paso de código)

1. **Quitar `NODE_ENV` de las variables de entorno de la app de Amplify**
   - Archivo exacto: `modules/amplify/main.tf` (modificar).
   - Cambio: borrar la línea `NODE_ENV                 = var.environment` (línea 74) dentro de `environment_variables` de `aws_amplify_app.this`. Quedan `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL` y `VITE_CAROUSEL_IMAGE_KEYS`.
   - Alineación: `terraform fmt` no cambia nada (la clave más larga es `VITE_CAROUSEL_IMAGE_KEYS`, así que el `=` de las otras ya está alineado a su ancho). Conserva los finales de línea del archivo.
   - Comentarios: no sobra ninguno (esa línea no tiene) y no se añade uno nuevo; la razón de quitarla va en `referencia-modulos.md`.
   - No tocar: `aws_amplify_branch.this` (no define `NODE_ENV`); `var.environment` en `variables.tf` (sigue en uso en el nombre de la app y en el `stage` de la rama); el `build_spec`.
   - Firmas que cambian: ninguna. Sin variables ni outputs nuevos o quitados.
   - Comprobación: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `environments/dev` y `environments/prod`; `node scripts/quality-check.mjs`; Grep de `NODE_ENV` con glob `*.tf`: cero coincidencias en `modules/amplify` (hoy `modules/amplify/main.tf:74` es la única en archivos `.tf` del repositorio); en `scripts/` ya da cero (ni `quality-check.mjs` ni `docs-check.mjs` mencionan `NODE_ENV`).
   - Norma: `buenas-practicas-terraform.md` (cambio mínimo, sin `provisioner`) y `docs/integracion/para-frontend.md` (contrato de `build_spec` y `VITE_*`).

## A cargo del tester-documentador

Cifras: en letras o con «kB» pegado a la cifra (por ejemplo «768 kB»); `docs-check` rechaza «número + módulos, entornos, recursos, variables, outputs, archivos, claves». Sin secretos, ARN ni identificadores de cuenta.

1. **`docs/referencia-modulos.md`, «Variables de Amplify».** Borrar la fila `NODE_ENV`. Añadir debajo de la tabla un párrafo corto: Amplify ya no define `NODE_ENV`; Vite fija `production` en `vite build` y Vitest fija `test`; fijar `production` en toda la app haría que `npm ci` omitiera las `devDependencies` (se perderían `vite` y `vitest`) y que Vitest usara el React de producción, donde `act` no funciona; con `NODE_ENV=dev`, React elegía su build de desarrollo aunque Vite imprimiera «building for production». Es la única explicación de «por qué no se define».
2. **`docs/integracion/para-frontend.md`.** En «Variables de entorno que Amplify define hoy», quitar la fila de `NODE_ENV` y añadir una nota debajo: Amplify ya no la define (M2); efecto esperado: un bundle de unos 768 kB, frente a unos 1058 kB, sin `react-dom.development` ni el aviso de DevTools; estado: resuelto en código y pendiente del `apply` de `dev` y de la verificación; `prod` (por confirmar) hasta su primer despliegue. Qué debe comprobar el frontend: rendimiento, que ningún componente dependa de avisos de desarrollo de React y que su CSP Report-Only y sus scripts no cambian. Quitar la afirmación «no afecta».
3. **`docs/estado-y-deuda-tecnica.md`.** Quitar la fila abierta M2 («M2 en revisión»). En «Resueltos», reescribir la fila M2 conservando el histórico: nota fechada del 31/10/2026 (el cierre «no afecta» anterior queda corregido; se mantiene su texto como histórico, log del build #7, pero fue erróneo); evidencia (bundle de desarrollo en `dev`, unos 1058 kB, unos 321 kB comprimido, con `react-dom.development`; sin `NODE_ENV`, unos 768 kB, unos 249 kB comprimido; comprobado en local con vite 6.4.3); corrección (quitar `NODE_ENV` de la app en `modules/amplify/main.tf`); estado «resuelto en código, pendiente del `apply` de `dev` y de la verificación» (`start-job` y curl o Playwright); `prod` (por confirmar) en su primer despliegue; † si la fila lo requiere. Nueva fila de deuda menor: el bundle de 768 kB aún supera el aviso de 500 kB de Vite; es para el frontend (división de código), relacionado con C15. «Última actualización: 31/10/2026». La fila C12 menciona el `NODE_ENV` del backend: es otro y no se toca.
4. **`docs/guias/buenas-practicas-terraform.md` (línea 106) y `README.md`.** Reescribir la línea de M2 como «`NODE_ENV` ya no se define en Amplify (M2): resuelto en código, pendiente del `apply` de `dev` y de la verificación; `prod` por confirmar». En el índice de specs del README, una fila para la spec, el plan y el aviso nuevos: «M2 reabierto: `NODE_ENV` quitado de Amplify; React en modo producción». No tocar más texto del README.
5. **Aviso de PR `docs/specs/2026-10-31-m2-node-env-react-aviso-pr.md`** (nuevo, con la estructura de los otros avisos).
   - Orden de despliegue: (1) humano: `terraform plan` en `dev`, revisión y `apply` en `dev`; (2) orquestador: `aws amplify start-job` solo en `dev`, rama `feature/testing`, perfil `sigmetum-preprod`, con la autorización expresa del 31/10/2026; (3) orquestador: verificación con curl y Playwright; (4) `prod`: en su primer despliegue (por confirmar).
   - Criterio de aceptación: el build y `npm test` terminan bien; el bundle desplegado no contiene `react-dom.development` ni «Download the React DevTools»; su tamaño es de unos 760 kB sin comprimir.
   - Reversión: si el build o los tests fallan, volver a poner la línea `NODE_ENV = var.environment`, `apply` y repetir el build.
   - Qué mirar en el `plan` (humano; no pegar la salida): un único cambio en sitio (`~`) en `aws_amplify_app.this` con la variable `NODE_ENV` desapareciendo del mapa; `aws_amplify_branch.this` no cambia; nada en otros módulos; sin `destroy` ni `replace`.
   - Frontend: comprobar rendimiento y tamaño del bundle, que ningún componente dependa de avisos de desarrollo de React y que su CSP Report-Only y sus scripts no cambian; su `docs/integracion/para-infra.md` (sección de variables de entorno de Amplify) todavía copia `NODE_ENV = var.environment` y debe actualizarlo. Backend: no afectado (el `NODE_ENV` de `app_env_vars` de Beanstalk es otro).

## Pruebas

- Sin pruebas nuevas ni modificadas; no se toca `plugins/`, así que no hace falta `node --test`.
- Verificación del tester-documentador: `terraform fmt -check -recursive`; `validate` en `dev` y `prod`; `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs` (este último lo ejecuta el orquestador).
- El `plan` y el `apply` los hace el humano. El `start-job` de `dev` y la verificación del bundle los hace el orquestador.

## Hallazgos fuera de la spec

1. `sigmetum-frontend/docs/integracion/para-infra.md` (línea que copia `NODE_ENV = var.environment`): es otro repositorio, no se toca aquí y queda como aviso en el PR.
2. La rama `aws_amplify_branch.this` usa `stage = DEVELOPMENT` en `dev`; es independiente de `NODE_ENV` y no se toca.
3. Las menciones de M2 en `estado-y-deuda-tecnica.md` y en `buenas-practicas-terraform.md` deben quedar coherentes (`docs-check` lo comprueba).

## Cierre

- Documentos de integración afectados: `docs/integracion/para-frontend.md` sí; `docs/integracion/para-backend.md` no.
- Segunda opinión: ninguna sobre el plan (cambio de una línea, causa ya comprobada en local); se pide sobre el diff.
