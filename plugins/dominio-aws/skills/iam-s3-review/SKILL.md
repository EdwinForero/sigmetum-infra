---
name: iam-s3-review
description: Lista de comprobación para revisar cambios de IAM, S3, secretos, red y TLS antes de un apply. Úsala al tocar políticas, roles, buckets, grupos de seguridad, certificados o variables sensibles.
---

# Revisión de IAM, S3, secretos, red y TLS

Las normas y su motivo están en `docs/guias/seguridad.md` (SEG-1 a SEG-8) y en su lista "Lista de comprobación para una PR" (sección 3). BP-8 de `docs/guias/buenas-practicas-terraform.md` cubre la protección contra borrado. Esta skill es el orden de revisión.

1. **Secretos** (SEG-1, SEG-2, SEG-5): ningún secreto, hash, ARN ni identificador de cuenta en `.tf`, ejemplos, documentos ni la PR; solo marcadores y nombres de variables. No leas `terraform.tfvars` ni `*.tfstate`.
2. **Sensibles**: variables con secretos con `sensitive = true`; outputs sin valores sensibles.
3. **IAM** (SEG-4): acciones y recursos concretos; ningún comodín en `Action`, `Resource` ni `Principal`. Revisa a mano los cambios de `modules/storage` y de `modules/backend-ci-iam`.
4. **S3** (SEG-6): los buckets nuevos llevan bloqueo de acceso público, cifrado, versionado y política TLS. Si guardan datos, `prevent_destroy` y sin `force_destroy` (BP-8). Un cambio de nombre o de configuración que fuerce reemplazo se avisa como riesgo de pérdida de datos.
5. **Red** (SEG-7): ningún puerto nuevo abierto a `0.0.0.0/0`; SSH cerrado por defecto.
6. **TLS** (SEG-8): HTTPS en lo que sirva tráfico real y certificado en la región del proveedor.
7. **Estado** (SEG-3, BP-5): cualquier cambio de `backend.tf` conserva cifrado y bloqueo.
8. **Rotación**: si hay que rotar un secreto, la PR lo dice y quién debe hacerlo (solo nombres de variables).
9. **Documentación**: actualiza la tabla de estado de `docs/guias/seguridad.md` y el hallazgo en `docs/estado-y-deuda-tecnica.md`; una deuda nueva entra también en `KNOWN_DEBT` de `scripts/quality-check.mjs`.
10. **Verificación**: ejecuta las entradas de `verificacion` de `.claude/flujo.json`. Para cambios de IAM, red o secretos, propón además `/security-review` a la persona responsable.
