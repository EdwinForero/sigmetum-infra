---
name: tf-module-change
description: Lista de comprobación para crear, renombrar, eliminar o modificar un módulo de Terraform. Úsala siempre que cambie algo bajo modules/ o la composición de un entorno.
---

# Cambio de módulo

Las normas y su motivo están en `docs/guias/buenas-practicas-terraform.md` y en la lista "Módulo nuevo o modificado" de `docs/guias/mantenimiento.md` (sección 6). Esta skill es el orden de trabajo; no las repite.

1. **Lee antes de escribir**: la guía de buenas prácticas (BP-1, BP-6 y BP-10) y, si el módulo toca IAM, S3, secretos, red, TLS o Amplify, la guía de seguridad.
2. **Responsabilidad única**: el módulo hace una cosa y los entornos solo lo componen y le pasan valores (BP-1). No declares recursos propios en `environments/`.
3. **Los dos entornos alineados**: compara los `main.tf` de `dev` y `prod`. Una diferencia intencionada se explica en el README.
4. **Etiquetas**: todo recurso que admita etiquetas lleva `Component`, y el valor figura en `docs/billing-tags.md` (BP-6).
5. **Estilo**: nombres en `snake_case`, sin `provisioner`, `null_resource` ni `local-exec` (BP-10).
6. **Variables y outputs**: si cambian, sigue la skill `tf-variable-output-change`.
7. **Contrato**: si el módulo es Amplify, storage, Beanstalk o DNS, o cambia dominios, región o bucket, sigue la skill `contract-change-review`.
8. **Seguridad**: si crea o cambia IAM o S3, sigue la skill `iam-s3-review`.
9. **Documentación**: aplica la fila que corresponda de la sección 2 de `docs/guias/mantenimiento.md` (README, referencia de módulos, métricas) en el mismo cambio.
10. **Verificación**: ejecuta las entradas de `verificacion` de `.claude/flujo.json`. Nunca `terraform plan`, `apply` ni `destroy`: pide a la persona responsable que revise el plan de preprod.
