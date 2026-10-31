---
name: amplify-change
description: Lista de comprobación para cambiar variables, build_spec, reglas o cabeceras de Amplify. Úsala al tocar modules/amplify.
---

# Cambio de Amplify

Las normas están en `docs/guias/seguridad.md` (SEG-9 y SEG-10) y en la lista "Amplify (variables, `build_spec`, reglas)" de `docs/guias/mantenimiento.md` (sección 6). El contrato con el frontend, en `docs/integracion/para-frontend.md`.

1. **Variables**: las mismas en `aws_amplify_app` y en `aws_amplify_branch`.
2. **Coherencia con el frontend**: contrasta las `VITE_*` con el `.env.example` del frontend; `docs-check` avisa de las que no coinciden.
3. **`build_spec`**: la versión de Node, `baseDirectory` y la caché son los que necesita el frontend (sección sobre `build_spec` de `para-frontend.md`).
4. **Cabeceras y acceso** (SEG-9): si cambian, revisa los orígenes que necesita el frontend y si preproducción debe ser privada.
5. **Token de GitHub** (SEG-10): `access_token` sigue con `sensitive = true`; ningún valor en documentos.
6. **Aviso para la PR**: cambiar una variable `VITE_*` exige una compilación nueva del frontend; dilo con la skill `contract-change-review`.
7. **Documentación**: actualiza "Variables de Amplify" de `docs/referencia-modulos.md`.
8. **Verificación**: ejecuta las entradas de `verificacion` de `.claude/flujo.json`.
