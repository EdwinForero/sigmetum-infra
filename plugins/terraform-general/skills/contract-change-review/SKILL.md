---
name: contract-change-review
description: Lista de comprobación para cambios que afectan al contrato con el frontend o el backend (variables VITE_*, build_spec, dominios, región, bucket, app_env_vars, health check, balanceador). Úsala antes de tocar esas áreas y al preparar el aviso de la PR.
---

# Revisión del contrato con otros repositorios

Los tres repositorios se despliegan por separado. La convención está en la sección 3 de `docs/guias/mantenimiento.md` (en especial la 3.6) y en BP-11 de `docs/guias/buenas-practicas-terraform.md`.

1. **Identifica el área** con la tabla 3.6 de `docs/guias/mantenimiento.md`: `VITE_*` o `build_spec`, dominios, región, bucket, `app_env_vars` o health check.
2. **Lee el documento que corresponda**: `docs/integracion/para-frontend.md` para Amplify, `build_spec`, `VITE_*`, dominios y recursos estáticos; `docs/integracion/para-backend.md` para `app_env_vars`, health check, ALB, DNS, IAM de S3 y plataforma.
3. **Contrasta con el otro repositorio, no de memoria**: `.env.example` y `docs/integracion/para-infra.md` del frontend; `config/validateEnv.js` y `index.js` del backend. Si no puedes comprobarlo, márcalo **(por confirmar)**.
4. **Cita los ids con el nombre del repositorio**: `frontend:I1`, `backend:B1`, `infra:C5`.
5. **Orden de despliegue**: decide qué va primero (por ejemplo, variables nuevas en Amplify antes de fusionar el frontend) y dilo.
6. **Aviso para la PR**: en `docs/specs/*-aviso-pr.md`, qué debe hacer cada repositorio y en qué orden desplegar; de las claves, solo los nombres. Si no hay impacto real, una línea que empiece por `Integración: sin impacto — ` seguida del motivo.
7. **Documentos de integración**: actualiza el `para-X.md` afectado. Si resuelves un hallazgo que venía de otro repositorio, dilo para que lo retire de su tabla.
8. **Documentación y verificación**: aplica `docsRegla` de `.claude/flujo.json` y ejecuta las entradas de `verificacion`; los avisos de `docs-check` entre repositorios se corrigen o se registran como hallazgo.
