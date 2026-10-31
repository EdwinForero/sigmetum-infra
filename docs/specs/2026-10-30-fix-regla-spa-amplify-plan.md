# Regla de reescritura SPA de Amplify: plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-fix-regla-spa-amplify-design.md`

Crítico: no según el architect (no cambian `VITE_*`, `build_spec` ni `app_env_vars`); el usuario pidió tratarlo como crítico por ser área de contrato (`modules/amplify/**`) y se pide segunda opinión sobre el plan y el diff.

## Fase 1

1. **Cambiar el `source` de la regla SPA**
   - Archivo: `modules/amplify/main.tf` (modificar, solo el `source` del segundo `custom_rule`).
   - Antes: `"</^((?!\\.).)+$>"`
   - Después, literal HCL exacto: `"</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|pdf)$)([^.]+$)/>"`
   - No cambian `target`, `status`, la regla `/assets/<*>` (sigue la primera) ni el resto del archivo.
   - Escape en HCL: `\\.` produce `\.` (obligatorio); `$|` y `$)` no disparan interpolación (solo `${` y `%{`); `terraform fmt` no toca el contenido de las cadenas. Misma forma que `para-infra.md` del frontend, sección 6.
   - Comprobación antes del `apply` (solo lectura): `Grep` de la cadena literal en `modules/amplify/main.tf` con 1 coincidencia; `git diff --stat` lista solo ese archivo con una línea cambiada; `terraform fmt -check -recursive` y `terraform validate` en dev y prod pasan.
   - Norma o contrato: `docs/guias/buenas-practicas-terraform.md`; `docs/integracion/para-frontend.md` ("Reglas de reescritura"); `para-infra.md` del frontend, sección 6.

2. **Puerta de calidad**
   - Sin archivos. Comprobación: `node scripts/quality-check.mjs` pasa. Si el escáner salta, es un falso positivo que se registra, no se silencia.

## A cargo del tester-documentador

- `docs/integracion/para-frontend.md`: poner el `source` nuevo como valor real (con `\.`, sin duplicar la barra); cambiar "rutas sin extensión" por rutas sin punto y rutas con punto fuera de la lista (también van a `index.html`; límite conocido); dejar `infra:C3` como está y añadir una fila `infra:C14` (= `frontend:I3`, `backend:F16`) como "Resuelto en código; comportamiento en dev y prod (por confirmar)"; "Resuelven infra:C3" pasa a "C3 y C14".
- `docs/estado-y-deuda-tecnica.md`: añadir C14 como resuelto en código, con la comprobación en el Amplify desplegado (por confirmar) y la condición de reapertura (`/explorar` sigue dando `301` o `404` tras el `apply`); no tocar C3; "Última actualización: 30/10/2026"; contar C14 en las cifras si el documento las lleva.
- `docs/referencia-modulos.md`: no procede según el architect; si `docs-gate` lo exige por `docsPorArea`, el tester lo anota y decide el orquestador. No inventar contenido.
- Aviso de PR `docs/specs/2026-10-30-fix-regla-spa-amplify-aviso-pr.md`: Frontend: actualizar la fila I3 y la nota de preprod en su `para-infra.md`, confirmar que ninguna ruta suya lleva un punto que ahora se reescriba y pedir extensiones nuevas si las usa. Backend: actualizar la mención de F16 en su `docs/integracion/para-frontend.md`. Orden: el humano hace `apply` en dev y prod; se comprueba con `curl` y `aws amplify get-app` en ambos; se reabre C14 si `/explorar` sigue dando `301` o `404`. Solo marcadores, sin ids de app, ARN ni cuenta.

## Pruebas

- Sin pruebas nuevas ni cambios en `plugins/`. Verificación: `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `node scripts/quality-check.mjs`, `node scripts/docs-check.mjs`, `node plugins/ciclo-agentico/scripts/docs-gate.mjs`.
- Comprobación tras el `apply` del humano, por entorno (por confirmar), todo en solo lectura:
  1. `aws amplify get-app --app-id <APP_ID> --query "app.customRules[].source" --output text` (con `--output text` para que `\.` no salga como `\\.`).
  2. Debe contener, en este orden, `/assets/<*>` y `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|pdf)$)([^.]+$)/>`; comparar carácter a carácter contra un archivo del scratchpad.
  3. `--query "app.customRules[].[source,target,status]"`: `/assets/<*>` a `/assets/<*>` con `200`, y la regex a `/index.html` con `200`.
  4. `curl -I` a `/explorar` da `200` sin `301`; `/assets/<fichero con hash>` da `200`; `/algo.v2` da `200` con `index.html`.
  - En prod depende de que el humano haga el `apply` allí; la URL es la de Amplify por defecto (el dominio es C9, abierto).

## Hallazgos fuera de la spec (no añadidos al alcance)

1. La causa de la spec (falta la `/` final) sigue sin confirmar: el `301` de `/explorar` a `/explorar/` puede ser una redirección propia de Amplify independiente de las reglas; si tras el `apply` sigue, hará falta otro cambio y C14 se reabre.
2. La fila `infra:C3` de `para-frontend.md` dice "Resuelto" y contradice a C14 hasta confirmar; decisión: se deja C3 y se añade la fila C14.
3. `aws_amplify_branch.this` no define `NODE_ENV` y la app sí; no afecta a este cambio.
