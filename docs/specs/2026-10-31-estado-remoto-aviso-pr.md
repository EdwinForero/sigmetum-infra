# Aviso para PR: estado remoto, versiones y archivo de bloqueo

Fecha: 2026-10-31 · Spec: `docs/specs/2026-10-31-estado-remoto-design.md` · Plan: `docs/specs/2026-10-31-estado-remoto-plan.md`

Integración: sin impacto — el cambio es solo de estado remoto, versión de Terraform, CI y archivos de bloqueo; no toca variables `VITE_*`, `build_spec`, dominios, región, bucket de datos ni `app_env_vars`. Sin cambios en el frontend ni en el backend, y sin orden de despliegue entre repositorios.

## Qué cambia

- `environments/dev/backend.tf` y `environments/prod/backend.tf`: `encrypt = true` y `use_lockfile = true` (bloqueo nativo de S3). Bucket, key y región no cambian.
- `required_version` pasa a `>= 1.11` en los dos `providers.tf`; la CI pasa a Terraform 1.15.5 (la versión del equipo).
- `.terraform.lock.hcl` se versiona, uno por entorno, con hashes de `windows_amd64` y `linux_amd64` (M5); `quality-check` ya no tiene deuda de backend ni de lockfile (S3).
- `docs/aws-organizations-setup.md` sección 5: bloqueo público, cifrado y política TLS del bucket de estado, con comprobación de solo lectura (S4 parcial).

## Qué debe hacer el humano, en este orden

1. Actualizar Terraform a 1.11 o superior si no lo tiene (el equipo usa 1.15.5).
2. Confirmar que los dos lockfiles están en el índice de git (ya añadidos) y repetir `node scripts/quality-check.mjs`.
3. En `environments/dev`: `AWS_PROFILE=sigmetum-preprod terraform init -reconfigure` y `terraform plan` sin pegar su salida. Mirar: `init` sin errores y **sin petición de migrar estado** (si la pide, parar; nunca `-migrate-state` ni responder «yes» a ciegas); `plan` con **cero cambios de recursos** (si propone alguno, parar).
4. Lo mismo en `environments/prod` con `AWS_PROFILE=sigmetum-prod`, después de dev. Solo una persona aplica por entorno durante la transición.
5. La CI cambia a Terraform 1.15.5: comprobar que pasa en la PR.
6. Con confirmación expresa, aplicar en el bucket de estado de dev la política TLS y las etiquetas (comandos del paso 4 y 5 de la sección 5 de `docs/aws-organizations-setup.md`) y comprobar con `get-bucket-policy`. Comprobar prod con los comandos de solo lectura (todo por confirmar hoy).

## Qué mirar

- Durante un `plan` o `apply` aparece un objeto temporal `terraform.tfstate.tflock` junto al estado. Un bloqueo huérfano se resuelve con `terraform force-unlock <id>` solo por una persona, tras confirmar que nadie más aplica; ningún rol del ciclo lo ejecuta.
- Permisos de S3 para el bloqueo (por confirmar): `s3:ListBucket` sobre el bucket y `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre el estado y sobre `terraform.tfstate.tflock`.
- Mac: los lockfiles no traen hashes de Mac; PR propia con `terraform providers lock -platform=darwin_arm64`.
- Estado de dev, comprobado el 31/10/2026: versionado, bloqueo público y cifrado cumplen; faltan política TLS y etiquetas. prod, por confirmar. El efecto en las cuentas es (por confirmar) hasta el `init -reconfigure`.
