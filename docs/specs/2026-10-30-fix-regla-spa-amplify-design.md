# Regla de reescritura SPA de Amplify: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

En el Amplify de dev, `/explorar` responde `301` a `/explorar/` y luego `404`, aunque las dos `custom_rule` de `modules/amplify/main.tf` están aplicadas (las reglas de la app coinciden con el código, verificado con `curl` y `aws amplify get-app` en solo lectura). Este problema es el F16 de `sigmetum-backend/docs/integracion/para-frontend.md` (`backend:F16`; en el frontend, `frontend:I3`). Se quiere que recargar o abrir un enlace directo a una ruta de la SPA devuelva `200` con `index.html`, sin redirección, y que `/assets/…` siga sirviéndose igual.

Hoy (verificado en código) la regla SPA tiene `source = "</^((?!\\.).)+$>"`, es decir, termina en `$>` y no en `/>`. Causa probable **(por confirmar)**: sin la `/` final Amplify no la trata como expresión regular. Solo se confirma en el Amplify desplegado, tras el `apply`.

## Decisiones registradas

1. Id: el hallazgo en `docs/estado-y-deuda-tecnica.md` es **C14** nuevo, con equivalencia `frontend:I3` y `backend:F16`. `C3` queda como estaba (resuelto en código con la regla anterior, sin reabrir).
2. Extensiones: la lista de la regex queda tal cual (css, gif, ico, jpg, js, png, txt, svg, woff, woff2, ttf, map, json, webp, pdf). Si el frontend usa otras, las pedirá después.
3. Regla `/assets/<*>`: se conserva.
4. Estado del hallazgo: C14 consta como **resuelto en código**, con la comprobación en el Amplify desplegado **(por confirmar)**. Si tras el `apply` `/explorar` sigue dando `301` o `404`, se reabre.
5. Entornos: el arreglo se despliega en **dev y prod a la vez** (el módulo es el mismo). El `apply` lo ejecuta el humano; ningún rol lo hace.

## Criterios de aceptación

### De código

1. La regla SPA de `modules/amplify/main.tf` usa `source` en formato `</regex/>` con la expresión `^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|pdf)$)([^.]+$)`, `target = "/index.html"` y `status = "200"`. Es la que recomienda `para-infra.md` del frontend (sección 6), ya ampliada con `woff2`, `webp` y `pdf`. Observación: coincide carácter a carácter con esa sección (salvo el escape `\\.` propio de HCL).
2. La regla de paso `/assets/<*>` (`target` `/assets/<*>`, `200`) se conserva y sigue antes que la regla SPA. Observación: `git diff` solo muestra el cambio del `source` de la regla SPA.
3. No cambian `build_spec`, variables `VITE_*`, `app_env_vars` ni `*.tfvars.example`. Observación: `git diff --stat` no los lista.
4. `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` pasan.
5. Comprobación que demuestra el arreglo, **solo tras el `apply` que hace el humano en dev y en prod, no los roles (por confirmar)**. Se repite en cada entorno:
   - `curl -I` a `/explorar` y a una ruta interna da `200` sin `301` a `/explorar/`.
   - Una recarga en una ruta interna desde el navegador carga la SPA.
   - `/assets/<fichero con hash>` sigue dando `200` con el fichero (no `index.html`).
   - `aws amplify get-app` (solo lectura) muestra las dos reglas con el `source` nuevo.
   - Una ruta con punto que no es recurso estático (por ejemplo `/algo.v2`) se reescribe a `index.html` (la lista de extensiones queda tal cual, decisión 2).
6. URL de cada entorno para el `curl`: en dev, la ya usada en la verificación. En prod, la URL por defecto de Amplify o el dominio **(por confirmar: C9 sigue abierto)**. La verificación en prod con `curl` y `aws amplify get-app` depende de que el usuario haya hecho el `apply` en prod.

### De documentación

1. `docs/integracion/para-frontend.md`: la tabla de "Reglas de reescritura" muestra el `source` nuevo de la regla SPA y explica que rutas con punto cuya extensión no está en la lista también se reescriben a `index.html`. Se recoge el `C14` (equivalencia `frontend:I3`, `backend:F16`): resuelto en código, comportamiento real en dev y prod por confirmar.
2. `docs/estado-y-deuda-tecnica.md`: se registra `C14` como resuelto en código, con la comprobación en el Amplify desplegado **(por confirmar)** y la condición de reapertura (decisión 4). `C3` no se modifica. "Última actualización: DD/MM/AAAA" con la fecha de hoy.
3. `docs/referencia-modulos.md`: se actualiza solo si describe las `custom_rule` de `modules/amplify`. Una búsqueda de `custom_rule`, `SPA` y `reescritura` no lo encontró en `docs/` fuera de `docs/specs/` y de los dos documentos anteriores, así que probablemente no procede **(por confirmar)**.
4. El aviso de PR (`docs/specs/*-aviso-pr.md`) indica qué debe hacer el frontend (actualizar su `para-infra.md` sección 1, fila I3, y su nota sobre preprod; pedir extensiones nuevas si las usa) y el backend (actualizar la mención de F16 en su `para-frontend.md`). Orden: `apply` en dev y prod (a la vez, lo ejecuta el humano), comprobar con `curl` y `aws amplify get-app` en ambos entornos, y reabrir C14 si `/explorar` sigue dando `301` o `404`.
5. Ningún documento nuevo contiene secretos, ARN ni ids de cuenta, solo marcadores.

## Fuera de alcance

- Cambios en `build_spec`, `VITE_*`, `app_env_vars` y `*.tfvars.example`.
- Cabeceras de caché y CSP (infra:C11).
- Dominio del frontend (infra:C9).
- Ejecutar `apply`, `plan` o cualquier comando de AWS que cambie recursos.
- Tocar los documentos de `sigmetum-frontend` y `sigmetum-backend`.
- Rutas con extensiones fuera de la lista (`.avif`, `.mp4`, `.xml`, `.webmanifest`): se reescriben a `index.html`; límite conocido, se amplía la lista solo si el frontend lo pide.
- Reabrir `C3`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta. `modules/amplify` es área de contrato. Cambia el `source` de una regla de reescritura. Para el frontend, las rutas de la SPA dejan de dar `301` y `404`. Es un cambio de comportamiento visible, aunque no cambia ninguna variable ni el `build_spec`. El frontend debe ajustar el estado de I3 en su `para-infra.md` (sección 1) y confirmar que ninguna ruta suya contiene un punto que ahora se reescriba ni usa extensiones fuera de la lista.
- `docs/integracion/para-backend.md`: no lo afecta. No cambian `app_env_vars`, health check, ALB, DNS ni IAM de S3. Solo hay que actualizar la mención de F16 en `sigmetum-backend/docs/integracion/para-frontend.md`, que es un documento del backend.

## Preguntas abiertas

Ninguna.
