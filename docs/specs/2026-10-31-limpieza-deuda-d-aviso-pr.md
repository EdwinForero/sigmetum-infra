# Aviso para PR: limpieza de deuda D (M12, M13, B2)

Fecha: 31/10/2026 · Cambio menor, sin spec ni plan · Toca `modules/storage` (bucket de datos) y `modules/beanstalk/outputs.tf`

## Qué cambia

- M12: en `modules/storage/main.tf`, `aws_s3_bucket_policy.cloudfront_oac` pasa a llamarse `aws_s3_bucket_policy.app`, con un bloque `moved`. La política no cambia. En `modules/beanstalk/outputs.tf` solo cambia el texto de la `description` de `load_balancers`; el valor no cambia.
- M13: `scripts/quality-check.mjs` admite la clave opcional `TRUST_PROXY_HOPS` en las plantillas `.example`; desaparece el aviso «¿sobra?».
- B2: el README y `docs/iam-role-setup.md` pasan a español. `scripts/docs-check.mjs` espera ahora `## Arquitectura`, la tabla `Recurso` y sus etiquetas y valores en español. Los enlaces con ancla al README se han actualizado.

## Qué mira el humano en `terraform plan` (dev y prod; no pegar la salida)

1. Esperado: ningún recurso a crear, cambiar o destruir. Terraform solo debe indicar que `aws_s3_bucket_policy.cloudfront_oac` se mueve a `aws_s3_bucket_policy.app`. Si propone sustituir la política o cualquier otro recurso, parar y revisar.
2. El `plan` real no se ha ejecutado desde aquí **(por confirmar)**. `terraform validate` pasa en los dos entornos.

## Frontend y backend

- **Frontend: nada que hacer.** `modules/amplify` no cambia.
- **Backend: nada que hacer.** `app_env_vars` no cambia.
- Orden de despliegue: ninguno.

## Documentos de integración

Integración: sin impacto — el cambio renombra una política sin modificarla, cambia una descripción de output sin tocar su valor y traduce documentación; no cambian `VITE_*`, el `build_spec`, dominios, región, bucket ni `app_env_vars`.

## Por confirmar

- `terraform plan` en `dev` y `prod` con solo el movimiento de la política.
