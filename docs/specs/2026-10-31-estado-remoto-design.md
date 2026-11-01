# Estado remoto, versiones y archivo de bloqueo: spec

Fecha: 2026-10-31 · Estado: cerrado

Ciclo B2 de infra. Hallazgos S3, M5 y S4 de `docs/estado-y-deuda-tecnica.md`; reglas BP-4 y BP-5 de `docs/guias/buenas-practicas-terraform.md` y SEG-3 de `docs/guias/seguridad.md`. **Cambio crítico** (estado remoto, CI).

## Objetivo

El estado de Terraform de cada entorno vive en un bucket de S3 sin cifrado explícito en el backend ni bloqueo de concurrencia, el archivo de bloqueo de proveedores no se versiona y el procedimiento manual del bucket de estado no recoge todos los controles (en dev faltan hoy la política TLS y las etiquetas; prod no se ha comprobado). El cambio cierra los tres huecos: el backend cifra y bloquea, los proveedores quedan fijados por entorno y el procedimiento del bucket de estado queda completo para cuentas nuevas, con una comprobación de solo lectura que dice qué falta en cada cuenta existente.

Supuestos de partida (verificados por el orquestador, no por este rol): el equipo usa Terraform v1.15.5; la CI usa `terraform_version: '1.9.8'` (`.github/workflows/ci.yml`, línea 39) y ejecuta `terraform init -backend=false` y `terraform validate` sin credenciales; `required_version = ">= 1.5"` en `environments/*/providers.tf`; los buckets de estado (`sigmetum-tfstate-dev` en preprod, `sigmetum-tfstate-prod` en prod) se crearon a mano.

## Decisiones registradas

Respuestas del usuario que cierran las preguntas del primer borrador:

1. **Plataformas del archivo de bloqueo:** `windows_amd64` y `linux_amd64`. Sin plataformas de macOS.
2. **Versión mínima:** `required_version = ">= 1.11"` en `environments/*/providers.tf` (igual en los dos entornos) y `terraform_version` de la CI (`.github/workflows/ci.yml`, línea de `terraform_version`) en 1.15.5, la que usa el equipo.
3. **Lectura del bucket de estado de dev:** autorizada y hecha (ver "Estado real del bucket de dev"). El bucket de prod lo comprueba quien tenga acceso, con el procedimiento documentado.
4. **Cifrado:** SSE-S3 (AES256), sin KMS.
5. **Bloqueo huérfano:** procedimiento humano con `terraform force-unlock`, tras confirmación expresa. Ningún rol del ciclo lo ejecuta. No se añade regla nueva: la prohibición ya está en `.claude/settings.json`.

## Estado real del bucket de dev

Comprobado el 31/10/2026 por el orquestador sobre `sigmetum-tfstate-dev` con el perfil `sigmetum-preprod`, solo con comandos `get-*` y `list`:

| Control | Resultado |
|---|---|
| Versionado | Activado |
| Bloqueo de acceso público | Las cuatro opciones a verdadero |
| Cifrado por defecto | Configurado, AES256 (SSE-S3) |
| Política de bucket | No existe (`NoSuchBucketPolicy`): no hay sentencia que exija TLS |
| Etiquetas | No tiene (`NoSuchTagSet`) |
| Contenido | Un solo objeto, el estado (`terraform.tfstate`, de unos cien kB), y ningún bloqueo |

Conclusión: de lo que pide S4, en dev ya cumplen versionado, bloqueo público y cifrado; faltan la política de TLS y las etiquetas (el procedimiento documentado las prevé, pero no se aplicaron). El bucket de prod no se ha comprobado (no hay perfil en la máquina de trabajo): **(por confirmar)** con el mismo procedimiento de solo lectura.

Consecuencia para el alcance de S4: el procedimiento debe seguir completo (sirve para cuentas nuevas) y la comprobación de solo lectura debe servir para ver qué falta en cada cuenta. En dev no hace falta aplicar nada salvo la política de TLS y las etiquetas, con comandos que ejecuta el humano con confirmación, no el rol.

Nota sobre permisos del bloqueo: como en dev no hay política de bucket y el perfil es administrador de SSO (S14), `terraform init` y `apply` con `use_lockfile` deberían funcionar sin cambios; solo necesitan que quien aplica pueda hacer PutObject, GetObject y DeleteObject sobre la clave `terraform.tfstate.tflock` (junto a la del estado), además de ListBucket (**por confirmar** con la documentación oficial). En prod, **(por confirmar)**.

## Criterios de aceptación

### De código

1. **S3, cifrado y bloqueo.** El `backend "s3"` de `environments/dev/backend.tf` y de `environments/prod/backend.tf` activa `encrypt = true` y el bloqueo nativo de S3 con `use_lockfile = true`. No se usa tabla de DynamoDB. Observación: `node scripts/quality-check.mjs` deja de mostrar la nota de deuda del backend de ambos entornos.
2. **Versión mínima.** `required_version` de `environments/*/providers.tf` es `>= 1.11`, igual en los dos entornos, y la versión de Terraform de `ci.yml` es 1.15.5, que lo cumple. Observación: `terraform init -backend=false` y `terraform validate` pasan en `environments/dev` y `environments/prod` con la versión de la CI y con la del equipo (que coinciden).
3. **Sin migración de estado.** Los cambios de `backend.tf` no alteran `bucket`, `key` ni `region`. Se documenta que el humano aplica el cambio con `terraform init -reconfigure` y que no hace falta `-migrate-state` porque el estado no cambia de sitio (por confirmar con la salida real de `init` del humano en dev; ningún rol lo ejecuta).
4. **M5, archivo de bloqueo.** Existe un `.terraform.lock.hcl` versionado en `environments/dev` y otro en `environments/prod`, generados con `terraform providers lock` para `windows_amd64` y `linux_amd64`, tras un `terraform init -backend=false`. Observación: `git ls-files` lista ambos; `terraform init -backend=false` con ellos no los modifica.
5. **M5, `.gitignore`.** La línea `.terraform.lock.hcl` desaparece del `.gitignore`; `.terraform/` y `*.tfstate` siguen ignorados.
6. **M5, sin secretos.** Los archivos de bloqueo solo contienen versión del proveedor, restricción y hashes; se comprueba por inspección que no hay valores de cuenta, claves ni tokens, y que no se tocó ni se leyó el estado.
7. **Puerta de calidad.** En `scripts/quality-check.mjs` se retiran de `KNOWN_DEBT` `lockfileIgnored` y las entradas de `stateBackend`; la puerta sigue pasando y falla si un `backend` pierde `encrypt` o el bloqueo, o si falta un archivo de bloqueo versionado por entorno. Observación: `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` en verde.
8. **Verificación completa.** `terraform fmt -check -recursive`, `terraform init -backend=false` y `terraform validate` en cada entorno, `quality-check`, `docs-check`, `docs-gate` y, si se toca `plugins/`, las pruebas de `plugins/`.

### De documentación

1. **Procedimiento del bucket de estado (S4), completo.** La sección 5 de `docs/aws-organizations-setup.md` queda como procedimiento completo para una cuenta nueva (preprod y prod): versionado, bloqueo de acceso público con sus cuatro opciones, cifrado explícito SSE-S3 (AES256), política que deniega el tráfico sin TLS (`aws:SecureTransport`) y etiquetas. Solo marcadores `<ID_CUENTA_DEV>`, `<ID_CUENTA_PROD>` y `<ID_CUENTA_GESTION>` donde haga falta un identificador; los nombres de bucket actuales no contienen identificador y pueden escribirse tal cual.
2. **Comprobación de solo lectura (S4).** El mismo documento (o una sección enlazada desde él) da, para cada cuenta, los comandos de solo lectura `aws s3api get-bucket-versioning`, `get-public-access-block`, `get-bucket-encryption`, `get-bucket-policy` y `get-bucket-tagging`, con el resultado esperado de cada uno y qué hacer si falta algo. Los ejecuta el humano o el orquestador con autorización expresa. `docs/aws-cli-setup.md` solo se toca si menciona el bucket de estado (hoy no hay coincidencias; confirmar).
3. **Estado real de las cuentas (S4).** `docs/estado-y-deuda-tecnica.md` recoge el resultado de la comprobación de dev del 31/10/2026 (versionado, bloqueo público y cifrado cumplen; faltan la política TLS y las etiquetas) y deja el bucket de prod como **(por confirmar)** hasta que lo compruebe quien tenga acceso. S4 solo pasa a resuelto en una cuenta cuando la comprobación de solo lectura muestra todos los controles. Los comandos que aplican la política TLS y las etiquetas en dev los ejecuta el humano con confirmación; ningún rol los ejecuta.
4. **Comentarios de `backend.tf`.** Los comentarios de cabecera de ambos `backend.tf` (que solo citan crear el bucket y activar versionado) apuntan al procedimiento completo en lugar de duplicarlo.
5. **Bloqueo y operación humana.** La documentación explica: permisos S3 necesarios para quien aplica; qué es el bloqueo huérfano (objeto `.tflock` que queda junto al estado si un `apply` se interrumpe); cómo lo libera el humano (leer el identificador del bloqueo del mensaje de error y usar `terraform force-unlock` con confirmación expresa, comprobando antes que nadie más está aplicando); y que ningún rol del ciclo ejecuta `force-unlock`.
6. **Permisos del bloqueo.** Se documenta qué necesita quien aplica sobre el bucket de estado: `s3:ListBucket` sobre el bucket y `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre el estado y sobre su objeto `.tflock` (por confirmar contra la documentación oficial vigente del backend S3; investigar con context7 o la documentación de Terraform durante la arquitectura). Se indica que la política TLS del bucket no debería interferir, que hoy quien aplica usa administrador de SSO (S14), por lo que el permiso solo importa si se cambia a un rol acotado, y que en dev no hay política de bucket (comprobado) mientras que en prod es **(por confirmar)**.
7. **Compatibilidad entre quienes aplican.** Se documenta que una versión de Terraform anterior a la mínima no conoce el bloqueo nativo y aplicaría sin bloquear, por lo que `required_version` es la barrera; y que el estado escrito por una versión más reciente puede no poder leerlo una anterior (por confirmar el comportamiento exacto).
8. **Reglas y estado.** Se actualizan BP-4, BP-5 y SEG-3 (regla y tabla de estado de cada guía; BP-4 cita las plataformas `windows_amd64` y `linux_amd64`), `docs/estado-y-deuda-tecnica.md` (S3 y M5 pasan a resueltos en código y S4 según el criterio anterior, con el efecto en las cuentas **(por confirmar)** hasta que el humano ejecute `init -reconfigure` y se compruebe el bucket; "Última actualización" con la fecha de hoy), `docs/guias/mantenimiento.md` (la línea que dice que `.terraform.lock.hcl` está en `.gitignore` y que no se suba, y el cómo se actualiza el archivo con `terraform init -upgrade` en una PR propia), `docs/referencia-modulos.md` y `README.md` si describen el backend o la versión mínima, y el comentario de `ci.yml`. Las cifras se escriben con letras (regla de `docs-check`).
9. **Aviso de PR.** Se deja indicado el orden operativo para el humano: actualizar Terraform a la versión mínima, `terraform init -reconfigure` en dev (preprod), comprobar el bloqueo en un `plan` o `apply` revisado, y después en prod. Sin impacto en el frontend ni en el backend.

## Fuera de alcance

- S2 y S6 (secretos), S13, S14 y M3 (importar los buckets de estado a Terraform), y el resto de hallazgos.
- Tabla de DynamoDB para el bloqueo (solo si el usuario la pide).
- Cifrado con KMS del bucket de estado (decidido SSE-S3).
- Cambios en `modules/`, en el frontend o en el backend.
- Ejecutar `terraform init -migrate-state`, `init -reconfigure`, `plan`, `apply`, `state`, `import`, `force-unlock` o cualquier comando de AWS que cambie recursos. Los pasos que crean o modifican el bucket de estado los ejecuta el humano.
- Crear o cambiar recursos reales de los buckets de estado: este ciclo solo documenta y comprueba.
- Quién puede leer el bucket de estado (S2): se menciona pero no se resuelve.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta (sin cambios en Amplify, `VITE_*`, `build_spec`, dominios ni recursos estáticos).
- `docs/integracion/para-backend.md`: no lo afecta (sin cambios en `app_env_vars`, health check, ALB, DNS, IAM de S3 ni plataforma de Beanstalk).
- Impacto operativo sobre el equipo y la CI: quien aplique necesita Terraform en la versión mínima elegida; la CI cambia de versión (área `.github/**` y `environments/**`, de contrato en `.claude/flujo.json`).

## Preguntas abiertas

Ninguna.
