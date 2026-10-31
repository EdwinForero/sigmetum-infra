---
name: pre-apply-checklist
description: Lista para preparar un terraform apply, primero en preprod y después en prod. Úsala cuando un cambio ya verificado vaya a desplegarse. La ejecuta la persona responsable; ningún rol del ciclo ejecuta apply ni plan.
---

# Antes de un apply

El flujo y su motivo están en BP-7 de `docs/guias/buenas-practicas-terraform.md`. **Ningún agente ejecuta `terraform apply`, `destroy` ni `plan`**: esta lista la completa una persona; el agente solo prepara el resumen.

Resumen que prepara el agente:

1. **Qué cambia**: módulos y entornos afectados, y qué recursos se esperan nuevos, cambiados o reemplazados. Marca **(por confirmar)** lo que solo el plan puede decir.
2. **Cuenta y entorno** que se verán afectados.
3. **Datos y costes**: si toca el bucket de datos (versionado, bloqueo, `prevent_destroy`, reemplazo por cambio de nombre) o un recurso facturable.
4. **Contrato**: si afecta al frontend o al backend, el orden de despliegue de la skill `contract-change-review`.

Lista para la persona responsable:

1. [ ] `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `quality-check` y `docs-check` en verde.
2. [ ] Si toca IAM, S3, secretos, red o TLS: revisada con la skill `iam-s3-review`.
3. [ ] `plan` de **preprod** (`environments/dev`) revisado por una persona, con el perfil de la cuenta correcta y sin pegar su salida en la PR ni en documentos.
4. [ ] Confirmación expresa antes de aplicar.
5. [ ] Comprobado el resultado en preprod.
6. [ ] Solo entonces, lo mismo en **prod** (`environments/prod`) desde `master`.
