# sigmetum-infra

Infraestructura de SIGMETUM-A con Terraform (Beanstalk, Amplify, S3, Route53). Documentación en `README.md` y `docs/`, en español (el README y las guías de puesta en marcha, en parte en inglés). Las guías normativas están en `docs/guias/`.

## Comandos

- `terraform fmt -check -recursive`: formato (desde la raíz)
- `terraform init -backend=false` y `terraform validate`: en `environments/dev` y `environments/prod`
- `node scripts/quality-check.mjs`: puerta de calidad y seguridad (formato, validación, reglas de los `.tf`, secretos, coherencia con los otros repositorios)
- `node scripts/docs-check.mjs`: comprueba que la documentación no se ha quedado atrás (`--metrics`, `--strict`)

## Prohibido sin confirmación expresa

- **No ejecutes `terraform apply` ni `terraform destroy`** (ni `terraform import`, `state rm`, `taint`...), ni comandos de AWS que creen, cambien o borren recursos. Tampoco con `-auto-approve`. Pide confirmación y dime qué cuenta y entorno se verían afectados.
- **No leas ni imprimas `terraform.tfvars`**: contienen secretos. Si necesitas saber qué variables define, muestra solo los nombres de las claves. Tampoco pegues la salida de `terraform plan` (puede incluir valores sensibles).
- No hagas commit ni push sin que te lo pidan.

## Antes de empezar: lee la guía que corresponda a la tarea

Las guías están en `docs/guias/`. Léelas **antes** de escribir código, no después:

| Si la tarea toca... | Lee |
|---|---|
| **Cualquier cambio de un `.tf`** (módulos, entornos, variables, outputs) | `docs/guias/buenas-practicas-terraform.md` |
| IAM, S3, secretos, red, TLS, Amplify o variables sensibles | `docs/guias/seguridad.md` |
| **Al terminar** cualquier cambio | `docs/guias/mantenimiento.md` |

Si lo que te piden **contradice una guía, avisa y pregunta antes de hacerlo**. Si la guía y el código se contradicen, dilo: no des por buena ninguna de las dos.

## Integración con otros repositorios

`sigmetum-frontend` y `sigmetum-backend` están en `../` y se despliegan por separado. **Antes de tocar `modules/amplify`, `modules/storage`, `app_env_vars`, dominios, región o el bucket**, lee el documento que corresponda:

| Si el cambio afecta a... | Lee |
|---|---|
| Amplify, `build_spec`, variables `VITE_*`, dominios, recursos estáticos | `docs/integracion/para-frontend.md` |
| `app_env_vars`, health check, ALB, DNS del backend, IAM de S3, plataforma de Beanstalk | `docs/integracion/para-backend.md` |

En el resumen final di **qué deben hacer los otros repositorios y en qué orden desplegar**; en la PR, rellena la sección "Frontend y backend" de `.github/pull_request_template.md`. Los ids de otros repositorios se escriben con su nombre (`frontend:I1`, `backend:B1`, `infra:C5`). `INTEGRACION.md` es la entrada a estos documentos.

## CI y plantilla de PR

`.github/workflows/ci.yml` ejecuta en cada PR la misma definición de terminado que este archivo (sin credenciales de AWS, sin `plan` ni `apply`); `.github/pull_request_template.md` recoge la misma lista. **Si cambias un comando, cámbialo en los tres sitios** (este archivo, la plantilla y la CI): `docs-check` comprueba que coinciden. `.claude/settings.json` (compartido) **hace cumplir** la prohibición de `apply`, `destroy`, `import`, `state`, `taint`, `untaint` y `force-unlock`, y de leer `terraform.tfvars` y `*.tfstate`; no lo debilites.

## Lo que nunca se hace (resumen; el detalle y el motivo están en las guías)

- Ejecutar `terraform apply`, `destroy`, `import` o `state` sin confirmación expresa, o comandos de AWS que cambien recursos.
- Escribir secretos, tokens, contraseñas, hashes, ARN o identificadores de cuenta en `.tf`, `*.example`, documentos, scripts o respuestas. Solo marcadores y nombres de variables.
- Leer o versionar `terraform.tfvars`, archivos de estado (`*.tfstate`) o `.terraform/`.
- Dejar una variable con secretos sin `sensitive = true`, o exponer un secreto en un output.
- Abrir `0.0.0.0/0` (sobre todo al puerto 22), usar permisos IAM con comodines (`*`) o abrir un bucket al público.
- Bucket de S3 sin bloqueo de acceso público, cifrado y versionado.
- Usar `provisioner`, `null_resource` o `local-exec`.
- Proveedores o módulos sin rango de versión acotado.
- Cambiar variables `VITE_*`, el `build_spec`, dominios, región, bucket o `app_env_vars` sin revisar el contrato con el frontend y el backend y dejarlo indicado.
- Dejar que los dos entornos (`dev` y `prod`) diverjan sin explicarlo en el README.

## Al terminar cualquier cambio

1. Actualiza los documentos que indica `docs/guias/mantenimiento.md` (sección 2) **en el mismo commit**.
2. Ejecuta `terraform fmt -check -recursive`, `terraform validate` (cada entorno), `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs`: los cuatro deben pasar.
3. Contrasta lo que escribas con el código; lo que no puedas comprobar (lo que hay desplegado en AWS), márcalo como **(por confirmar)**.
4. Si tocas variables `VITE_*`, el `build_spec`, dominios, región, bucket o `app_env_vars`, revisa `../sigmetum-frontend/docs/integracion/para-infra.md` y `../sigmetum-backend/config/validateEnv.js` y deja indicado en el resumen qué debe hacer cada repositorio (sección 3 de `mantenimiento.md`).
5. Las variables, outputs y claves de `app_env_vars` solo viven en `docs/referencia-modulos.md`; las cifras y los hallazgos, en `docs/estado-y-deuda-tecnica.md`. Una deuda nueva se anota allí y, si `quality-check` la tolera, en `KNOWN_DEBT`.

## Reglas de trabajo

- Código y mensajes de commit en inglés; documentación en español.
- Los fallos de la puerta de calidad se corrigen, no se silencian: una excepción nueva solo entra en `KNOWN_DEBT` con su hallazgo registrado.
- Al crear archivos con barras invertidas (expresiones regulares), usa el editor, no `cat <<EOF`.
