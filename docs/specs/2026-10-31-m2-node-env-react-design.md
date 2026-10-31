# M2 reabierto, NODE_ENV en Amplify y build de desarrollo de React: spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

La web de `dev` sirve el build de desarrollo de React (bundle de unos 1058 kB sin comprimir, unos 321 kB comprimido, con `react-dom.development` y el aviso de DevTools en consola), aunque el paso de compilación del build #7 de Amplify dice «building for production». La app de Amplify define `NODE_ENV` con el valor del entorno (`dev` o `prod`, no estándar). Hay que conseguir que el bundle publicado en ambos entornos sea el de producción sin romper `npm ci`, `npm test` ni `npm run build`, y reabrir y volver a cerrar M2 con la evidencia.

Hechos comprobados en el código actual:

- `modules/amplify/main.tf`: `NODE_ENV = var.environment` está en las variables de la app; la rama no lo define. El `build_spec` ejecuta `nvm install 22 && nvm use 22`, `npm ci`, `npm test` (preBuild) y `npm run build`.
- Frontend: `build` es `vite build` y `test` es `vitest run`; la config de Vite y Vitest es el mismo archivo (`vite.config.js`, sin `mode` ni `define` de `NODE_ENV`). `vite`, `vitest`, `jsdom` y las librerías de pruebas están en `devDependencies`. Ningún archivo de `src/` lee `NODE_ENV`, `import.meta.env.MODE`, `DEV` ni `PROD`.
- Causa **confirmada** en local (ver «Confirmación local»): Vite respeta un `NODE_ENV` ya definido y, con `dev`, React elige su build de desarrollo aunque Vite imprima «building for production...».
- Descartado: fijar `NODE_ENV=production` en toda la app. `npm ci` con `production` omite las `devDependencies` (se perderían `vite` y `vitest`) y Vitest usaría el React de producción, donde las utilidades de prueba (`act`) no funcionan.

## Decisiones registradas

1. `NODE_ENV` se **quita** de las variables de entorno de la app de Amplify. Vite fija `production` en `vite build`, Vitest fija `test` y `npm ci` instala todo. No se fija `production` en toda la app (motivo arriba).
2. El build de verificación en `dev` lo lanza el orquestador con `aws amplify start-job` tras el `apply` del humano. Autorización expresa del usuario, dada el 31/10/2026, **solo** para la app de Amplify de `dev`, rama `feature/testing`, perfil `sigmetum-preprod`. Después verifica con curl y Playwright. No cubre `prod` ni ningún otro comando de AWS que cambie recursos.
3. `prod` de Amplify no se despliega todavía. El código del módulo se corrige igual para ambos entornos; se verifica solo en `dev` y `prod` se verifica en su primer despliegue.
4. La causa se comprobó en local; no hace falta pedir la comprobación al frontend.

## Confirmación local

Hecha por el orquestador el 31/10/2026 con el mismo código del frontend (vite 6.4.3), `vite build` hacia una carpeta temporal y sin tocar el repositorio del frontend:

- Con `NODE_ENV=dev`: bundle JS de unos 1058 kB (unos 321 kB comprimido); contiene `react-dom.development` y el aviso de DevTools.
- Sin `NODE_ENV` (variable no definida): bundle de unos 768 kB (unos 249 kB comprimido), un 27 % menos; no contiene ninguna de las dos marcas.
- En ambos casos Vite imprime «building for production...», por eso el log del build #7 no delataba el problema.

Causa: **confirmada** (ya no es hipótesis).

## Criterios de aceptación

### De código

1. Tras el cambio, `terraform fmt -check -recursive`, `terraform validate` (`dev` y `prod`), `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` pasan.
2. El `build_spec` mantiene `nvm install 22 && nvm use 22`, `npm ci`, `npm test` y `npm run build` en las mismas fases; `aws_amplify_branch` y el resto de variables de entorno (`VITE_*`) no cambian. La única variable que desaparece es `NODE_ENV`, en el código del módulo común a `dev` y `prod`.
3. Ni `npm ci` ni `npm test` reciben `NODE_ENV=production`; `npm run build` termina con bundle de producción.
4. El `plan` de `dev` y de `prod` (lo ejecuta el humano) solo modifica la app de Amplify de cada entorno (en el sitio: variables de entorno), sin reemplazos ni destrucciones.
5. Comprobación de la causa: hecha en local (ver «Confirmación local»); no se repite.
6. Comprobación en `dev`: tras el `apply` del humano, el orquestador lanza el build con `aws amplify start-job` (solo `dev`, rama `feature/testing`, perfil `sigmetum-preprod`). Se verifica que:
   - el build y `npm test` terminan bien;
   - el bundle desplegado en la web de `dev` (curl y Playwright) no contiene `react-dom.development` ni el aviso «Download the React DevTools»;
   - su tamaño es de unos 760 kB sin comprimir.

   Si el build o los tests fallan, se revierte: vuelve la variable.
7. `prod`: el efecto se verifica en su primer despliegue tras el `apply`; mientras no se haya comprobado, se marca **(por confirmar)**.

### De documentación

1. `docs/estado-y-deuda-tecnica.md`: el cierre anterior de M2 («no afecta») queda corregido. M2 se reabre con la evidencia (bundle de desarrollo, cifras de la confirmación local, build #7) y se resuelve con la corrección **en código**, con la nota «pendiente del `apply` de `dev` y de la verificación»; se retira la nota «M2 en revisión»; fecha de «Última actualización» al día; una frase para el frontend: debe comprobar que ningún componente depende de avisos de desarrollo de React. Cifras en letras o con «kB» pegado a la cifra, para que `docs-check` no las rechace.
2. `docs/integracion/para-frontend.md`: la fila de `NODE_ENV` y la lista de variables que Amplify define reflejan que la variable se quita, sin la afirmación «no afecta».
3. `docs/referencia-modulos.md`: la tabla de variables de entorno de Amplify (hoy con `NODE_ENV` igual a `environment`) refleja el cambio.
4. `docs/guias/buenas-practicas-terraform.md` (línea de deudas que cita M2) queda coherente con el nuevo estado de M2.
5. Aviso de PR (`docs/specs/*-aviso-pr.md`): qué debe hacer el frontend (rendimiento, tamaño del bundle, que su CSP Report-Only y los scripts no cambian, que ningún componente depende de avisos de desarrollo) y en qué orden desplegar (`apply` en `dev`, build, verificación; `prod` en su primer despliegue).
6. Sin secretos, identificadores de cuenta ni IP reales; solo nombres de variables.

## Fuera de alcance

- Cualquier otro cambio de Amplify (dominios, cabeceras, reglas, `VITE_*`), el backend y el resto de la deuda.
- Cambios en el código del frontend (config de Vite, scripts, pruebas): si hiciera falta alguno, se pide al frontend.
- Ejecutar `plan` o `apply`: lo hace el humano; ningún rol. La única acción de AWS autorizada es el `start-job` de `dev` de la decisión 2.
- Reducir el tamaño del bundle por otros medios (división de código, `npm audit`; ya anotado como C15).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: **lo afecta.** Cambia el entorno de compilación de Amplify (`NODE_ENV` deja de definirse), y con él el bundle publicado (React de producción: más pequeño y rápido, sin avisos de desarrollo). `VITE_*`, dominios, bucket y región no cambian. El frontend debe comprobar rendimiento, tamaño del bundle, que ningún componente dependa de avisos de desarrollo, y que su CSP Report-Only y sus scripts no cambian.
- `docs/integracion/para-backend.md`: **no lo afecta.** El `NODE_ENV` de Beanstalk (`app_env_vars`) es otro y no se toca.

## Preguntas abiertas

Ninguna.
