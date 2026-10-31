# Aviso para PR: M2 reabierto, NODE_ENV fuera de Amplify

Fecha: 31/10/2026 · Cambio **crítico** (contrato con el frontend: entorno de compilación de Amplify) · Spec: [design](2026-10-31-m2-node-env-react-design.md) · Plan: [plan](2026-10-31-m2-node-env-react-plan.md)

## Qué cambia

- `modules/amplify/main.tf`: se quita `NODE_ENV = var.environment` de las variables de entorno de la app de Amplify (una línea). `VITE_*`, el `build_spec`, la rama, dominios, cabeceras y reglas no cambian. El cambio es del módulo común, así que afecta a `dev` y a `prod`.
- Motivo: con `NODE_ENV=dev`, la web de `dev` servía el build de desarrollo de React (bundle de 1058 kB, con `react-dom.development` y el aviso de DevTools) aunque Vite imprimiera «building for production». El cierre anterior de M2 como «no afecta» era erróneo y queda corregido en `docs/estado-y-deuda-tecnica.md`.
- Causa confirmada con una medición local (vite 6.4.3, sin tocar el repositorio del frontend): con `NODE_ENV=dev`, 1058 kB; sin la variable, 768 kB y sin ninguna de las dos marcas.
- No se fija `NODE_ENV=production` en toda la app: `npm ci` omitiría las `devDependencies` (se perderían `vite` y `vitest`) y Vitest usaría el React de producción, donde `act` no funciona.

## Qué mira el humano en `terraform plan` (dev; no pegar la salida)

1. Un único cambio en sitio (`~`) en `aws_amplify_app.this`, con `NODE_ENV` desapareciendo del mapa de variables de entorno.
2. `aws_amplify_branch.this` no cambia; nada en otros módulos; sin `destroy` ni `replace`. Si aparece algo más, parar y revisar.
3. `prod` tiene el mismo cambio en el código, pero no se aplica todavía (Amplify de `prod` sin desplegar).

## Orden de despliegue

1. Humano: `terraform plan` en `dev`, revisión y `apply` en `dev`.
2. Orquestador: `aws amplify start-job` **solo** en `dev` (rama `feature/testing`, perfil `sigmetum-preprod`), con la autorización expresa del usuario del 31/10/2026. No cubre `prod` ni otros comandos de AWS que cambien recursos.
3. Orquestador: verificación con curl y Playwright.
4. `prod`: en su primer despliegue, **(por confirmar)**.

## Criterio de aceptación (dev)

- El build y `npm test` terminan bien.
- El bundle desplegado no contiene `react-dom.development` ni «Download the React DevTools».
- Su tamaño es de unos 760 kB sin comprimir.

## Reversión

Si el build o los tests fallan: volver a poner la línea `NODE_ENV = var.environment` en `modules/amplify/main.tf`, `apply` y repetir el build.

## Frontend y backend

- **Frontend (debe actuar):** comprobar rendimiento y tamaño del bundle; comprobar que ningún componente depende de avisos de desarrollo de React; comprobar que su CSP Report-Only y sus scripts no cambian. Actualizar su `docs/integracion/para-infra.md` (sección de variables de entorno de Amplify), que todavía copia `NODE_ENV = var.environment`. Opcional, fuera de infra: el bundle restante (768 kB) aún supera el aviso de 500 kB de Vite (M14, relacionado con C15).
- **Backend: no afectado.** El `NODE_ENV` de `app_env_vars` de Beanstalk es otro y no se toca.

## Documentos de integración

`docs/integracion/para-frontend.md` actualizado (variables que Amplify define hoy y nota de M2). `docs/integracion/para-backend.md`: sin impacto.

## Por confirmar

- `plan` y `apply` en `dev`, y la verificación del bundle desplegado (`start-job`, curl y Playwright).
- Efecto en `prod`, en su primer despliegue.
