# Mantenimiento de la documentación

Este documento dice **qué hay que revisar y actualizar después de cada cambio en Terraform**. Es la regla de trabajo del repositorio: Claude Code la sigue a través de [CLAUDE.md](../../CLAUDE.md), y las personas, con la lista de la PR. Forma un conjunto con las otras guías de esta carpeta: [buenas-practicas-terraform.md](buenas-practicas-terraform.md) (cómo se escribe y se cambia la infraestructura) y [seguridad.md](seguridad.md) (seguridad de la infraestructura).

## 1. La regla

1. **La documentación se actualiza en el mismo commit (o la misma PR) que el cambio.** Un cambio no está terminado hasta que pasa la lista de este documento.
2. **Se contrasta con el código, nunca de memoria.** Si no puedes comprobar algo (por ejemplo, lo que hay desplegado en la cuenta de AWS), márcalo como **(por confirmar)**.
3. **Cada dato vive en un solo sitio.** Los demás documentos enlazan, no copian:
   - variables, outputs y claves de `app_env_vars`: [referencia-modulos.md](../referencia-modulos.md);
   - cifras (módulos, archivos, variables, recursos) y hallazgos: [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md).
4. **Nunca hay secretos ni valores reales** en la documentación, las plantillas ni la salida del script: solo nombres de variables (ver sección 7).
5. **Definición de terminado:** `terraform fmt -check -recursive`, `terraform validate` de cada entorno, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs`, los cuatro en verde (sección 4). **Nunca `terraform apply` ni `terraform destroy` sin confirmación expresa.**

## 2. Qué documento tocar según el cambio

| Si cambias... | Actualiza | Comprueba |
|---|---|---|
| Un **módulo** nuevo, renombrado o eliminado | Bloque "Architecture" y tabla del [README](../../README.md), sección "Módulo ..." de [referencia-modulos.md](../referencia-modulos.md), métricas de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md#métricas) | Lo usa algún entorno; `docs-check` lo valida |
| Un **módulo existente** (recursos nuevos o quitados) | Sección del módulo en [referencia-modulos.md](../referencia-modulos.md), tabla del README si cambia un nombre, etiqueta o tamaño | Las etiquetas `Component` siguen en [billing-tags.md](../billing-tags.md) |
| **Variables o outputs** de un módulo o entorno | [referencia-modulos.md](../referencia-modulos.md) (tablas "Variables" y "Outputs", con "Por defecto" correcto) | `environments/*/terraform.tfvars.example` si es una variable obligatoria del entorno; `sensitive = true` si es un secreto |
| Un **entorno** nuevo | Bloque "Architecture", tabla del README, sección "Entorno ..." de la referencia, guías de [terraform-setup.md](../terraform-setup.md) y [aws-organizations-setup.md](../aws-organizations-setup.md) | Su `terraform.tfvars.example`, `providers.tf` y `backend.tf` |
| El **`build_spec`**, las reglas o las variables de **Amplify** | "Variables de Amplify" en [referencia-modulos.md](../referencia-modulos.md) y secciones 2, 3 y 6 de `para-infra.md` del frontend (ver sección 3 de este documento) | Node, `baseDirectory` y caché coinciden con lo que necesita el frontend |
| Un **ajuste de Beanstalk** (balanceador, health check, tipo de instancia, despliegue, SSH) | README (tabla de recursos) y sección "Módulo beanstalk"; [billing-tags.md](../billing-tags.md) si cambia el coste | El health check coincide con la ruta del backend; el coste mensual |
| **`app_env_vars`** (añadir, quitar o renombrar una clave) | Tabla `app_env_vars` de [referencia-modulos.md](../referencia-modulos.md), las dos plantillas `terraform.tfvars.example` | Las claves obligatorias de `../sigmetum-backend/config/validateEnv.js`; **contrato**, ver sección 3 |
| El **bucket S3** o sus políticas (acceso público, CORS, IAM, versionado) | README, "Módulo storage" y sección 5 de `para-infra.md` del frontend | Rutas que usa el backend (`../sigmetum-backend/config/s3Paths.js`); **contrato**, ver sección 3 |
| **DNS** o dominios (Route53, dominio de Amplify, certificado) | README (fila DNS), "Módulo dns", secciones 4 y 7 de `para-infra.md` | `ALLOWED_ORIGIN` del backend y `VITE_BASE_URL` del frontend; región del certificado |
| La **región** o la **cuenta** (proveedor, estado remoto, perfiles SSO) | `providers.tf`, `backend.tf`, README (fila Region), [aws-cli-setup.md](../aws-cli-setup.md), [aws-organizations-setup.md](../aws-organizations-setup.md), plantillas `.example` | `AWS_REGION` en `app_env_vars` y el ARN de ACM están en la misma región |
| **Costes** (tipo de instancia, ALB, autoescalado, etiquetas) | README (tabla), [billing-tags.md](../billing-tags.md) | Etiquetas `Project`, `Environment`, `ManagedBy`, `Component` |
| **Secretos** o cómo se gestionan | README (sección "Secrets"), [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) (S2) | `sensitive = true`, `.gitignore`, ningún valor en plantillas |
| La **versión** de Terraform, del proveedor o de la plataforma de Beanstalk | `providers.tf`, [terraform-setup.md](../terraform-setup.md), "Módulo beanstalk" | La versión de Node de la plataforma sirve al backend y al build del frontend |
| Una **regla de las guías** (`docs/guias/`), o cualquier `.tf` que la incumpla o la cambie | La guía afectada ([buenas-practicas-terraform.md](buenas-practicas-terraform.md) o [seguridad.md](seguridad.md)): su regla y su tabla de estado | `node scripts/quality-check.mjs`; la deuda nueva en `KNOWN_DEBT` y en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) |
| **IAM, S3, secretos, red, TLS, Amplify** o una variable sensible | [seguridad.md](seguridad.md) (regla, tabla de estado y lista de PR) y [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) | Ningún secreto ni identificador de cuenta; `sensitive = true`; sin permisos comodín |
| Una **guía nueva** en `docs/guias/` | Tabla "Documentation" del README y la tabla "Antes de empezar" de [CLAUDE.md](../../CLAUDE.md) | `docs-check` exige las dos |
| Una **guía de puesta en marcha** (`docs/aws-*.md`, `terraform-setup.md`, `iam-role-setup.md`) | La propia guía y, si cambia un comando o una ruta, el README | `docs-check` valida los enlaces; los comandos se revisan a mano |
| Un **hallazgo** resuelto o nuevo | [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) (ciclo en la sección 5) | Si venía de `para-infra.md`, avisar al frontend (sección 3) |
| **Documentos** nuevos, renombrados o movidos | Tabla "Documentation" del README | `docs-check` valida los enlaces y que todo `docs/*.md` esté enlazado |
| Los **scripts** `scripts/docs-check.mjs` o `scripts/quality-check.mjs` | Sección 4 de este documento | Que sigue detectando deriva (provocar un fallo y revertirlo) |

## 3. Contrato con el frontend y el backend (convención entre repositorios)

SIGMETUM-A son **tres repositorios** (`sigmetum-frontend`, `sigmetum-backend`, `sigmetum-infra`) que se despliegan por separado. Esta convención es **la misma en los tres** (modelo: sección 6 de `../sigmetum-frontend/docs/guias/mantenimiento.md`).

### 3.1 Dónde vive cada cosa

Cada repositorio tiene `docs/integracion/` con **un documento por cada uno de los otros dos**: `para-<destinatario>.md`.

| Repositorio | Documentos de `docs/integracion/` |
|---|---|
| `sigmetum-frontend` | `para-backend.md`, `para-infra.md` |
| `sigmetum-backend` | `para-frontend.md`, `para-infra.md` |
| `sigmetum-infra` | [para-frontend.md](../integracion/para-frontend.md), [para-backend.md](../integracion/para-backend.md) |

Un `para-X.md` **está escrito para quien mantiene X**: qué necesita y qué espera este repositorio de X, qué ofrece, el estado de las discrepancias y qué avisar si algo cambia. **Documentos de los repositorios hermanos** (este repositorio los contrasta, no los copia):

- **Frontend:** `../sigmetum-frontend/docs/integracion/para-infra.md` en local, y en GitHub https://github.com/EdwinForero/sigmetum-frontend/blob/master/docs/integracion/para-infra.md (el enlace solo funciona cuando la rama `feature/sigmetum_front_v2` se fusione en `master`; **por confirmar**).
- **Backend:** no tiene `docs/integracion/` propio; su contrato con esta infraestructura es `../sigmetum-backend/config/validateEnv.js`, `index.js` y `aws/awsS3connect.js`, citados en [para-backend.md](../integracion/para-backend.md).

### 3.2 Quién es dueño de cada hecho

Cada dato se documenta **en el repositorio que lo decide**; los demás lo enlazan y lo contrastan, no lo copian.

| Hecho | Dueño | Fuente |
|---|---|---|
| Endpoints, variables obligatorias del backend, salud, CORS | `sigmetum-backend` | `config/validateEnv.js`, `index.js`, `aws/awsS3connect.js` |
| Variables `VITE_*`, recursos estáticos que pide la web | `sigmetum-frontend` | `.env.example`, `src/config/assets.js` |
| Recursos de AWS, valores por entorno, dominios, cabeceras, reglas de Amplify | `sigmetum-infra` | Los `.tf` y [referencia-modulos.md](../referencia-modulos.md) |

### 3.3 Estructura de un `para-X.md`

1. Propósito y verificación (fecha, commits, **(verificado)** / **(por confirmar)**). 2. Resumen de lo que falta o no encaja. 3. Contrato. 4. Discrepancias (id, qué pasa, dónde, responsable, qué hacer; solo lo vigente). 5. "Si cambias algo". 6. Cómo mantenerlo.

### 3.4 Identificadores

Cada documento numera sus discrepancias con su propio prefijo (`F1`, `B1`, en este repositorio también `C*` de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md)). **Al citar uno de otro repositorio se escribe con el nombre del repositorio:** `frontend:I1`, `backend:B1`, `infra:C5`. Sin eso, dos `I1` distintos se confunden.

### 3.5 Qué hacer cuando cambia algo

- **Cambias algo que afecta a otro repositorio:** actualiza el `para-X.md` correspondiente **y** deja constancia en la PR (qué cambia, qué debe hacer el otro equipo y **en qué orden desplegar**).
- **Otro repositorio cambia algo:** revisa la sección "Si cambias algo" de su documento y actualiza el tuyo.
- **Discrepancia resuelta en el otro repositorio:** verifica el cambio contra su código y quítala de la tabla.
- **El orden de despliegue importa:** si hacen falta cambios coordinados (por ejemplo variables nuevas en Amplify antes de fusionar el frontend), se dice en la PR.

### 3.6 Qué revisar según el cambio

| Si cambias... | Revisa | Deja indicado en la PR |
|---|---|---|
| Las variables **`VITE_*`** que recibe Amplify, o el **`build_spec`** | Secciones 1, 2 y 3 de `para-infra.md` y `../sigmetum-frontend/.env.example` | Qué variable cambia y qué debe hacer el frontend |
| Los **dominios** (frontend o backend) o la URL del backend | Secciones 1, 3 y 4 de `para-infra.md` | El valor nuevo de `VITE_BASE_URL` y de `ALLOWED_ORIGIN` |
| La **región** | Sección 7 de `para-infra.md`; `AWS_REGION` del backend | Que backend y frontend no dependen de la región antigua |
| El **bucket** (nombre, acceso, CloudFront) | Secciones 1 y 5 de `para-infra.md`; `VITE_S3_URL`; `AWS_BUCKET_NAME` | Qué recursos dejan de ser accesibles o cambian de URL |
| **`app_env_vars`** (`ALLOWED_ORIGIN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_*`, `EMAIL*`...) | Variables obligatorias de `../sigmetum-backend/config/validateEnv.js` y sección 4 de `para-infra.md` | Qué claves hay que añadir o cambiar en cada `terraform.tfvars` (**solo nombres**) |
| El **health check** o el balanceador | Ruta de salud de `../sigmetum-backend/index.js` y sección 4 de `para-infra.md` | La ruta nueva |

Cuando el frontend cambia `para-infra.md`, revisa su sección 1 y actualiza los hallazgos `C` de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) y [para-frontend.md](../integracion/para-frontend.md). Cuando resuelves uno, dilo en la PR para que el frontend lo quite de su tabla de discrepancias.

### 3.7 GitHub: CI, plantilla de PR y ajustes que no están en el código

En el código: [ci.yml](../../.github/workflows/ci.yml) ejecuta la definición de terminado (`terraform fmt`, `validate` por entorno, `quality-check`, `docs-check`) sin credenciales de AWS ni `plan`/`apply`; un segundo trabajo con `trivy config` es **informativo** hasta limpiar la línea base de [seguridad.md](seguridad.md) (pasará a bloquear entonces); [pull_request_template.md](../../.github/pull_request_template.md) recoge la misma lista; [dependabot.yml](../../.github/dependabot.yml) actualiza proveedores y acciones cada semana; [CODEOWNERS](../../.github/CODEOWNERS) es una propuesta.

**Ajustes que hay que hacer en GitHub (no se pueden versionar) — (por confirmar) si ya están activos:**

- Proteger la rama principal (`master`): exigir que pase la CI (`Formato, validación, calidad y documentación`), exigir revisión y prohibir el push directo.
- Exigir revisión de los propietarios de código si se adopta `CODEOWNERS` (sustituir antes el marcador `@equipo-infra`).
- Activar **Dependabot security updates** y las alertas de dependencias en Settings → Code security.
- Mejora futura: rol OIDC de solo lectura para publicar el `plan` de preprod en la PR; el `apply` sigue siendo siempre manual.

## 4. Validación

### Lo que comprueba `node scripts/docs-check.mjs`

El script ([scripts/docs-check.mjs](../../scripts/docs-check.mjs)) no tiene dependencias y no necesita `terraform init` ni credenciales (este repositorio no tiene `package.json`). **Falla con código de salida 1** si algo no coincide:

| Comprobación | Código | Documento |
|---|---|---|
| Enlaces y anclas internos | Todos los `.md` | Los propios `.md` |
| Índice de documentos | `docs/*.md` | Tabla "Documentation" del README |
| Módulos y entornos | `modules/*`, `environments/*` y `source` de cada entorno | Bloque "Architecture" del README y secciones de la referencia |
| Tabla de recursos | Nombres, rama, tipo de instancia, balanceador, HTTPS, DNS y región | Tabla del README |
| Variables y outputs | `variables.tf` y `outputs.tf` (nombres y si tienen `default`) | [referencia-modulos.md](../referencia-modulos.md) |
| Plantillas de valores | `terraform.tfvars.example` (claves, región, ARN de ACM, bucket) | Referencia y proveedor |
| Variables de Amplify | `environment_variables` de `modules/amplify` | "Variables de Amplify" de la referencia |
| Etiquetas y sensibles | `Component`, `default_tags` y variables con nombre de secreto | [billing-tags.md](../billing-tags.md) |
| Secretos | Tokens, claves de AWS y hashes en documentos, plantillas y `.tf`; `.tfvars` y estado versionados; `.gitignore` | Nunca se muestra el valor encontrado |
| Métricas | Recuento real de módulos, entornos, archivos, variables, outputs y recursos | Tabla de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md#métricas), la **única** con cifras |

`--metrics` imprime los valores reales para esa tabla. `--strict` convierte los avisos en fallos.

### Avisos frente a los otros repositorios

Se imprimen pero **no hacen fallar** (hoy hay hallazgos abiertos que los provocan: C1, C4 y C6). Si un repositorio hermano no existe en `../`, la comprobación se salta con un aviso.

| Aviso | Compara |
|---|---|
| Claves de `app_env_vars` | Tabla de la referencia frente a `required` en `../sigmetum-backend/config/validateEnv.js` |
| Variables `VITE_*` | Las de `modules/amplify` frente a `../sigmetum-frontend/.env.example`: las que el frontend lee y Amplify no define, y al revés |
| Health check | `HealthCheckPath` de Beanstalk frente a la ruta `/healthcheck` del backend |
| `http://` en `backend_url` | Contenido mixto con el frontend servido por HTTPS |
| Documento del frontend | Que exista `para-infra.md` |

Un aviso nuevo se trata como una comprobación pendiente: o se corrige, o se registra como hallazgo `C` y se menciona en la PR.

### Lo que comprueba `node scripts/quality-check.mjs`

Puerta de calidad y seguridad ([scripts/quality-check.mjs](../../scripts/quality-check.mjs)): no tiene dependencias, **falla con código 1** ante un problema nuevo y muestra como nota (`·`) la deuda conocida que tiene id. Nunca ejecuta `apply`, `destroy`, `import` ni comandos de AWS, y nunca lee `terraform.tfvars`.

| Comprobación | Qué busca |
|---|---|
| Terraform | `terraform fmt -check -recursive` y, por entorno, `terraform init -backend=false` + `terraform validate`. Sin el binario o sin red: aviso, no fallo |
| Escáneres opcionales | `tflint`, `trivy config` (alta y crítica) y `checkov`, si están instalados; si no, recomienda instalarlos |
| Reglas de los `.tf` | `0.0.0.0/0` hacia SSH u otros puertos; buckets sin bloqueo de acceso público, cifrado o versionado; políticas con comodines; variables sin `type` o `description`; nombres de secreto sin `sensitive = true`; proveedores sin rango acotado; recursos sin `Component`; `provisioner`; `backend` sin `encrypt` ni bloqueo |
| Secretos | Claves de AWS, claves privadas, tokens de GitHub, hashes bcrypt, ARN e identificadores de cuenta en `.tf`, ejemplos, documentos y scripts |
| Git | `.tfvars`, `.tfstate`, `.terraform/`, claves o `.env` versionados; `.gitignore`; estado de `.terraform.lock.hcl` |
| Coherencia entre repositorios | Avisos: `VITE_*` de Amplify frente a `.env.example` del frontend, y claves de `app_env_vars` de las plantillas frente a las obligatorias del backend |

**Excepciones aceptadas por escrito:** viven en la constante `KNOWN_DEBT` del script, cada una con el id de su hallazgo en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md). Al resolver un hallazgo, se quita de la constante y se pasa a "Resueltos". Una excepción nueva sin hallazgo registrado no es aceptable. Las recomendaciones de instalar `tflint`, `trivy` y `checkov` son opcionales (**por confirmar** si el equipo los adopta).

Además, `docs-check` exige que cada guía de `docs/guias/` figure en la tabla "Documentation" del README y en [CLAUDE.md](../../CLAUDE.md).

### Formato y validación de Terraform (sin `apply`)

```bash
terraform fmt -check -recursive              # desde la raíz; `terraform fmt -recursive` lo corrige
cd environments/dev                          # y lo mismo en environments/prod
terraform init -backend=false                # no toca el estado remoto ni pide credenciales
terraform validate
```

- **`terraform apply` y `terraform destroy` no se ejecutan sin confirmación expresa** de la persona responsable, y siempre con el perfil de la cuenta correcta.
- `terraform plan` necesita credenciales y puede imprimir valores sensibles: no pegues su salida en la PR ni en documentos.
- `.terraform/` y `.terraform.lock.hcl` están en `.gitignore`; no los subas.

### Lo que el script **no** puede comprobar

Es revisión manual, y por eso está en las listas de la sección 6:

| Qué | Cómo |
|---|---|
| Que lo descrito **es cierto** (recursos, ajustes, comportamiento) | Leer el `.tf` que cambió y el párrafo que lo describe |
| Lo que hay **desplegado** en cada cuenta y los `terraform.tfvars` reales | Solo con acceso a la cuenta; márcalo **(por confirmar)**. Nunca pegues valores: solo nombres de claves |
| Que los hallazgos con el frontend y el backend **siguen vigentes** | Revisar el código del otro repositorio antes de afirmarlo |
| Los **costes** | Estimarlos con el precio de la región y anotarlo en la PR |
| **Términos obsoletos** | Buscar en los documentos: `REACT_APP`, `eu-west-3`, `AWS_ACCESSKEYID`, `sigmetum-dev` como nombre de bucket. Solo en notas históricas |
| Los **comandos** de las guías de puesta en marcha | Ejecutarlos en una cuenta de pruebas o revisarlos contra la documentación de AWS |

## 5. Hallazgos y deuda técnica

Se registran en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md).

| Prefijo | Significado |
|---|---|
| **C** | Contrato con el frontend o el backend (incluye los `I1` a `I7` de `para-infra.md`, con su id del frontend en una columna) |
| **S** | Seguridad y secretos |
| **M** | Mantenibilidad y robustez |
| **B** | Detalles y baja prioridad |
| **R** | Resuelto (solo en la tabla "Resueltos") |

Ciclo de vida:

1. **Se anota** con id, prioridad, descripción (con **(verificado)** o **(por confirmar)**), ubicación (`archivo` o módulo), qué hay que hacer y responsable (el repositorio o equipo que debe actuar).
2. **Se resuelve** con un commit; `terraform validate`, `quality-check` y `docs-check` en verde, y se quita su excepción de `KNOWN_DEBT` si la tenía.
3. **Pasa a "Resueltos"** con el hash del commit. No se borra: el historial explica por qué la infraestructura es como es.

Los ids no se reutilizan. Si un hallazgo se descarta, se queda con una nota ("No procede: motivo").

## 6. Listas de comprobación por tipo de cambio

### Módulo nuevo o modificado

- [ ] Está en el bloque "Architecture" del README y tiene sección en la referencia, con sus variables y outputs.
- [ ] Lo usa algún entorno, y los dos entornos siguen alineados (o la diferencia se explica en el README).
- [ ] Tiene etiqueta `Component` si crea recursos que se facturan, y figura en [billing-tags.md](../billing-tags.md).
- [ ] `terraform fmt -check -recursive`, `terraform validate`, `quality-check` y `docs-check` en verde.
- [ ] La lista de [buenas-practicas-terraform.md](buenas-practicas-terraform.md#3-lista-de-comprobación-para-una-pr); y la de [seguridad.md](seguridad.md#3-lista-de-comprobación-para-una-pr) si toca IAM, S3, secretos, red, TLS o Amplify.
- [ ] Si toca el contrato con otro repositorio, está indicado en la PR (sección 3).

### Variable, output o clave de `app_env_vars`

- [ ] Tabla de la referencia con el tipo y el "Por defecto" correctos.
- [ ] Si es obligatoria en un entorno, está en su `terraform.tfvars.example`.
- [ ] Si es un secreto: `sensitive = true` y ningún valor en documentos ni plantillas.
- [ ] Si es una clave de `app_env_vars`, coincide con `validateEnv.js` del backend y la PR dice qué debe añadirse al `terraform.tfvars` real de cada cuenta.

### Amplify (variables, `build_spec`, reglas)

- [ ] "Variables de Amplify" actualizada; coinciden con el `.env.example` del frontend (sin avisos).
- [ ] Las mismas variables en `aws_amplify_app` y en `aws_amplify_branch`.
- [ ] Node, `baseDirectory` y caché del `build_spec` son los del frontend (sección 2 de `para-infra.md`).
- [ ] La PR indica que cambiar una variable `VITE_*` exige una compilación nueva del frontend.

### Bucket, DNS, región o cuenta

- [ ] README, referencia y guías actualizados.
- [ ] La región de `providers.tf`, `backend.tf`, `AWS_REGION` y el ARN de ACM coincide.
- [ ] `ALLOWED_ORIGIN`, `VITE_BASE_URL` y `VITE_S3_URL` siguen siendo coherentes (sección 3).
- [ ] Coste revisado y anotado en la PR.

### Corrección de un hallazgo

- [ ] Se pasa a "Resueltos" con el hash del commit y una línea sobre la causa.
- [ ] Si describía el problema en otro documento, se reescribe en presente y sin el aviso.
- [ ] Si venía de `para-infra.md`, la PR lo dice para que el frontend lo retire de su tabla.

### Refactor sin cambio de infraestructura

- [ ] `terraform validate` en verde y, con credenciales, `terraform plan` **sin cambios** (sin pegar su salida).
- [ ] Se actualizan los nombres y rutas que cambien en README y referencia.

### Antes de fusionar la rama

- [ ] `node scripts/docs-check.mjs --metrics` y se actualiza la tabla de métricas si cambió alguna cifra.
- [ ] Fecha y commit del encabezado de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md).
- [ ] Los avisos entre repositorios están corregidos o registrados.
- [ ] No quedan términos obsoletos (sección 4).

## 7. Estilo y seguridad

- **Idioma:** español. El código y los mensajes de commit, en inglés.
- **Formato:** tablas para datos comparables, listas para pasos.
- **Certeza:** marca **(verificado)** lo comprobado contra el código y **(por confirmar)** lo que depende de la cuenta de AWS o de otro repositorio.
- **Enlaces:** a archivos con ruta relativa. No copies contenido que ya existe en otro documento.
- **Sin secretos:** nunca valores de `terraform.tfvars`, tokens, contraseñas, hashes ni claves. Solo nombres de variables. Las plantillas usan marcadores (`CHANGE_ME_...`, `YOUR_...`).
- **Identificadores de cuenta:** no los escribas en documentos nuevos; usa marcadores (`<ID_CUENTA>`).
- **Fechas:** absolutas (`30/09/2026`), no relativas.

## 8. Plantilla para la PR

```markdown
## Documentación
- [ ] `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` en verde
- [ ] Listas de las guías pasadas (buenas prácticas siempre; seguridad si toca IAM, S3, secretos, red, TLS o Amplify)
- [ ] Documentos actualizados: (lista)
- [ ] Sin `apply` ni `destroy` ejecutados (o confirmados por: ...)
- [ ] Afecta al contrato con otros repositorios: sí / no. Si sí:
  - Frontend (`VITE_*`, `build_spec`, dominios, región, bucket): qué debe hacer
  - Backend (`app_env_vars`, `ALLOWED_ORIGIN`, `ADMIN_*`): claves (solo nombres) que hay que añadir o cambiar en cada `terraform.tfvars`
- [ ] Hallazgos resueltos o nuevos: (ids)
- [ ] Avisos de `docs-check` entre repositorios: corregidos / registrados
```

## 9. Mantener este documento

- Se actualiza cuando aparece un tipo de cambio que no está en la tabla de la sección 2.
- Si una comprobación manual de la sección 4 se puede automatizar, se añade a `scripts/docs-check.mjs` (documentación) o a `scripts/quality-check.mjs` (código y seguridad) y se mueve a la tabla correspondiente.
- El script y este documento se revisan juntos: que un documento figure en la tabla 2 y no tenga comprobación automática es aceptable, pero debe ser una decisión consciente.
