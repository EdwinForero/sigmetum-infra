# Estado y deuda técnica

Registro de hallazgos de `sigmetum-infra`, con su referencia cruzada al frontend y al backend. Es el **único** documento que contiene cifras del repositorio (ver [mantenimiento.md](guias/mantenimiento.md#1-la-regla)).

- Fecha de la revisión: 30/09/2026. Rama `feature/testing`, sobre el commit `19bdde3` (con cambios sin confirmar).
- Contrastado con: `sigmetum-frontend` (`docs/integracion/para-infra.md`, `.env.example`) y `sigmetum-backend` (commit `ace5367`: `config/validateEnv.js`, `index.js`).
- Ningún `.tf` se ha modificado para esta revisión. Los `terraform.tfvars` reales no se han leído: solo se comprobaron los **nombres** de las claves del de `dev`.
- **(verificado)** = comprobado contra el código de este repositorio o de los hermanos. **(por confirmar)** = depende de la cuenta real de AWS o de un entorno desplegado.

## Métricas

Se actualizan con `node scripts/docs-check.mjs --metrics`. El script falla si esta tabla no coincide con el código.

| Métrica | Valor |
|---|---|
| Módulos | 5 |
| Entornos | 2 |
| Archivos .tf | 25 |
| Variables de módulos | 26 |
| Outputs de módulos | 13 |
| Recursos declarados | 10 |
| Claves de app_env_vars | 10 |

## Abiertos

Prefijos y ciclo de vida en [mantenimiento.md](guias/mantenimiento.md#5-hallazgos-y-deuda-técnica). La columna "Frontend" es el id que usa `para-infra.md` del frontend (sección 1). El **responsable** es el repositorio (equipo) que debe actuar; los nombres de persona no constan **(por confirmar)**.

### Contrato con el frontend y el backend

| Id | Frontend | Prioridad | Hallazgo | Dónde | Qué hay que hacer | Responsable |
|---|---|---|---|---|---|---|
| **C1** | I1 | Alta | **Sigue vigente (verificado).** Amplify define `VITE_API_URL` en la app y en la rama; el frontend lee `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL` y, opcional, `VITE_CAROUSEL_IMAGE_KEYS`. La web compilada llama a `localhost` | `modules/amplify/main.tf` (dos bloques `environment_variables`) | Definir las variables que lee el frontend en app y rama (`VITE_S3_URL` necesita una variable nueva del módulo) y corregir la descripción de `backend_url`, que aún habla de `REACT_APP_API_URL`. Lo señala `docs-check` | infra |
| **C2** | I2 | Alta | **Sigue vigente (verificado).** El bucket activa los cuatro bloqueos de acceso público y el repositorio no tiene CloudFront; el frontend carga `assets/*` desde el navegador sin autenticar (403) | `modules/storage/main.tf` | Elegir entre CloudFront con OAC, recursos en `public/` del frontend o política de lectura solo de `assets/*` (opciones en la sección 5 de `para-infra.md`) y apuntar `VITE_S3_URL` al resultado | infra y frontend |
| **C3** | I3 | Alta | **Sigue vigente (verificado).** No hay `custom_rule` de reescritura de la SPA en `aws_amplify_app`: recargar `/explorar` da 404 | `modules/amplify/main.tf` | Añadir la regla de la sección 6 de `para-infra.md` | infra |
| **C4** | I4 | Baja | **Aplazado hasta tener dominio propio en dev.** En `dev`, `backend_url` es `http://${module.beanstalk.endpoint_url}` (instancia única sin HTTPS) y Amplify sirve el frontend por HTTPS: el navegador bloquea las peticiones mixtas. Decisión: dev se queda sin HTTPS hasta disponer de un dominio; entonces se añade ALB + ACM o un CNAME propio. Lo señala `docs-check` | `environments/dev/main.tf` | Cuando haya dominio dev: añadir ALB con certificado ACM o dominio propio con CNAME y cambiar `backend_url` a `https://` | infra |
| **C5** | I5 | Alta | **Sigue vigente (verificado por nombres).** El `terraform.tfvars` de `dev` define `PORT`, `AWS_REGION`, `AWS_BUCKET_NAME`, `JWT_SECRET`, `JWT_EXPIRATION`, `EMAIL` y `EMAIL_PASSWORD`: faltan `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ALLOWED_ORIGIN`, que el backend exige al arrancar. El de `prod` no está en este equipo **(por confirmar)**. Las plantillas `.example` y la [referencia](referencia-modulos.md#app_env_vars) ya las incluyen | `terraform.tfvars` de cada entorno (fuera de git) | Añadir las tres claves en cada cuenta y hacer `apply`. `ALLOWED_ORIGIN` exige conocer antes la URL del frontend (dos vueltas de `apply` o dominio propio) | infra |
| **C6** | I6 | Media | **Sigue vigente en el código (verificado); el efecto real está por confirmar.** `HealthCheckPath` es `/` y el backend solo responde en `/healthcheck`; en `/` Express devuelve 404. Lo señala `docs-check` | `modules/beanstalk/main.tf` (`HealthCheckPath`) | Cambiar a `/healthcheck` y comprobar el estado del entorno | infra |
| **C7** | I7 | Media | **Sigue vigente (verificado).** Nada sube `assets/…` al bucket (no hay `aws_s3_object` ni se documenta un `s3 sync`) | `modules/storage`, [README](../README.md) | Documentar y automatizar la carga, o resolver con la opción B de C2 | infra y frontend |
| **C8** | — | Media | `branch_url` construye `https://${var.branch}.${domain}`; con la rama `feature/testing` la URL tendría una `/` (Amplify la sustituye por `-`) **(por confirmar)**. Es el origen que iría en `ALLOWED_ORIGIN` de `dev` | `modules/amplify/outputs.tf` | Sustituir `/` por `-` en el output y comprobarlo en la consola de Amplify | infra |
| **C9** | — | Media | Falta el dominio del frontend en `prod`: `modules/dns` solo crea `backend.<zona>` y no hay `aws_amplify_domain_association` (sección 4 de `para-infra.md`) | `modules/dns`, `environments/prod/main.tf` | Decidir el dominio del frontend y asociarlo a la rama `master`; será el valor de `ALLOWED_ORIGIN` en `prod` | infra |
| **C10** | — | Media | El `build_spec` no fija Node 20 ni ejecuta `npm test`; la imagen de Amplify puede traer otra versión **(por confirmar)** (sección 2 de `para-infra.md`) | `modules/amplify/main.tf` (`build_spec`) | Fijar Node en `preBuild` y ejecutar los tests antes de desplegar | infra y frontend |
| **C11** | — | Baja | Sin cabeceras de caché (`index.html` sin caché, `/assets/*` inmutable) ni política CSP (sección 6 de `para-infra.md`) | `modules/amplify/main.tf` | Añadir `customHeaders`; la CSP es opcional | infra |
| **C12** | — | Media | El límite de intentos del login (10 cada 15 min por IP) puede agrupar a todos los usuarios tras el balanceador si el backend no configura `trust proxy`: `index.js` no lo configura (verificado); el efecto real está por confirmar | `sigmetum-backend/index.js` | Decidirlo en el backend; infra solo confirma que el ALB reenvía `X-Forwarded-For` | backend |

### Propios de este repositorio

| Id | Prioridad | Hallazgo | Dónde | Qué hay que hacer | Responsable |
|---|---|---|---|---|---|
| **S1** | Media | Las guías `aws-cli-setup.md` y `aws-organizations-setup.md` contienen identificadores de cuenta de AWS reales. No son secretos, pero facilitan el reconocimiento de la organización | [aws-cli-setup.md](aws-cli-setup.md), [aws-organizations-setup.md](aws-organizations-setup.md) | Decidir si se sustituyen por marcadores (`<ID_CUENTA>`) | infra |
| **S2** | Media | `terraform.tfvars` guarda tokens y contraseñas en texto en el equipo de quien despliega; el estado remoto también los contiene (`app_env_vars`, sensible solo en la salida) | `environments/*/terraform.tfvars` (fuera de git), estado en S3 | Valorar Secrets Manager o SSM Parameter Store para los secretos; mientras tanto, cifrado y acceso restringido al bucket de estado y rotación del token de GitHub | infra |
| **S3** | Media | El bloque `backend "s3"` no activa `encrypt` ni un bloqueo de concurrencia (`use_lockfile` o tabla de DynamoDB): dos `apply` simultáneos pueden corromper el estado **(verificado)**. `use_lockfile` exige subir `required_version` | `environments/*/backend.tf` | Activar `encrypt = true` y el bloqueo; subir `required_version` si hace falta. Ver [BP-5](guias/buenas-practicas-terraform.md#bp-5-estado-remoto-cifrado-versionado-bloqueo-y-acceso) | infra |
| **S4** | Media | El procedimiento manual del bucket de estado solo activa versionado y etiquetas: no crea bloqueo de acceso público ni política TLS, y el cifrado no se fija **(por confirmar)** en la cuenta real | [aws-organizations-setup.md](aws-organizations-setup.md#5-crear-los-buckets-de-terraform-state) | Añadir esos pasos al procedimiento y comprobarlos en cada cuenta. Ver [SEG-3](guias/seguridad.md#seg-3-el-estado-de-terraform-contiene-secretos) | infra |
| **S5** | Media | El bucket de datos no tiene política que exija TLS ni registros de acceso **(verificado)** | `modules/storage/main.tf` | Añadir `aws_s3_bucket_policy` con `aws:SecureTransport` y registros en un bucket de logs. Ver [SEG-6](guias/seguridad.md#seg-6-s3-bucket-de-datos-y-recursos-públicos) | infra |
| **S6** | Media | Los secretos de `app_env_vars` (`JWT_SECRET`, `EMAIL_PASSWORD`, `ADMIN_PASSWORD`) son propiedades de entorno de Beanstalk, legibles en la consola por quien pueda leer la configuración **(verificado)** | `modules/beanstalk/main.tf` (bloque `dynamic "setting"` de `app_env_vars`) | Evaluar Parameter Store o Secrets Manager con la integración de secretos de Beanstalk. Ver [SEG-2](guias/seguridad.md#seg-2-secretos-de-la-aplicación-dónde-viven-en-beanstalk) | infra y backend |
| **S7** | Media | La política de `modules/storage` da `PutObject` y `DeleteObject` sobre todo el bucket al rol compartido de las instancias, incluida la carpeta de recursos públicos del frontend; se añade a un rol cuyo nombre está escrito a mano **(verificado)** | `modules/storage/main.tf` | Limitar escritura a los prefijos que use el backend (`../sigmetum-backend/config/s3Paths.js`) y separar `assets/*` | infra y backend |
| **S8** | Media | No hay redirección de 80 a 443 en el ALB de prod (verificado por ausencia en el código; el efecto real es **(por confirmar)**). `dev` no tiene HTTPS (C4) | `modules/beanstalk/main.tf` | Configurar la redirección en el listener por defecto, o desactivarlo | infra |
| **S9** | Baja | La rama de preproducción de Amplify no tiene autenticación básica: es pública si alguien conoce la URL **(verificado por ausencia de `enable_basic_auth`; intención por confirmar)** | `modules/amplify/main.tf` | Decidir si preproducción debe ser privada | infra |
| **S10** | Media | El token de GitHub es un token personal clásico con alcance `repo` (README): da acceso a todos los repositorios de quien lo creó | [README](../README.md#2-github-personal-access-token) | Sustituirlo por una GitHub App o un token de alcance mínimo y fijar una rotación | infra |
| **S11** | Media | No hay en Terraform CloudTrail, alertas de facturación ni registros de la aplicación (`StreamLogs = false`) **(verificado)**; si existen en las cuentas es **(por confirmar)** | `modules/beanstalk/main.tf` | Comprobarlo en cada cuenta y, si falta, añadirlo | infra |
| **S12** | Alta | **(por confirmar)** Si las claves de acceso antiguas que quedaron expuestas en una copia local de la configuración de Elastic Beanstalk ya se rotaron y desactivaron | Cuenta de AWS (fuera del repositorio) | Confirmar la rotación; si no se hizo, rotarlas ya | infra |
| **S13** | Baja | Se usa el VPC por defecto con IP pública en las instancias; los grupos de seguridad los crea Beanstalk y no están en Terraform; el cifrado del disco raíz depende de la cuenta **(por confirmar)** | `modules/networking`, `modules/beanstalk` | Valorar una red propia con subredes privadas y cifrado de EBS por defecto | infra |
| **S14** | Baja | Terraform se ejecuta con el permiso de administrador de SSO | [aws-cli-setup.md](aws-cli-setup.md), [iam-role-setup.md](iam-role-setup.md) | Al automatizar, usar un rol con permisos mínimos | infra |
| **M1** | Baja | `ssl_certificate_arn` está declarada en `environments/dev` y no se usa; la variable `environment` de `modules/networking` tampoco se usa | `environments/dev/variables.tf`, `modules/networking/variables.tf` | Eliminarlas o usarlas | infra |
| **M2** | Baja | Amplify recibe `NODE_ENV` con `dev` o `prod`, que no son valores estándar (`production`) **(por confirmar)** si afectan a la compilación | `modules/amplify/main.tf` | Probar la compilación sin `NODE_ENV` o con un valor estándar | infra |
| **M3** | Baja | Los buckets de estado y los roles de Beanstalk se crean a mano (no los gestiona Terraform); `modules/storage` añade la política al rol compartido `aws-elasticbeanstalk-ec2-role` | [aws-organizations-setup.md](aws-organizations-setup.md#6-crear-los-roles-de-beanstalk-en-cada-cuenta) | Mantener el procedimiento documentado; valorar importarlos a Terraform | infra |
| **M4** | Baja | `terraform fmt -check -recursive` falla en `environments/prod/main.tf` (alineación del módulo `dns`) **(verificado)**. También lista el `terraform.tfvars` local de `dev`, que está fuera de git | `environments/prod/main.tf` | Ejecutar `terraform fmt` en un commit aparte (no se ha tocado ningún `.tf` en esta revisión) | infra |
| **M5** | Media | `.terraform.lock.hcl` está en `.gitignore`: cada persona puede resolver una versión distinta del proveedor. La decisión es versionarlo ([BP-4](guias/buenas-practicas-terraform.md#bp-4-versiones-y-archivo-de-bloqueo)) | `.gitignore` | Quitarlo del `.gitignore`, ejecutar `terraform providers lock` con las plataformas en uso y versionar uno por entorno | infra |
| **M6** | Media | El bucket de datos no tiene `prevent_destroy` ni regla de ciclo de vida para las versiones antiguas **(verificado)** | `modules/storage/main.tf` | Añadir `prevent_destroy = true` y expirar versiones no actuales. Ver [BP-8](guias/buenas-practicas-terraform.md#bp-8-protección-contra-borrado) | infra |
| **M7** | Baja | Varias variables no tienen `description`, solo una tiene `validation` y la mayoría de los outputs no tiene `description`; varios outputs de módulo no los consume ningún entorno. Las claves de `app_env_vars` no se validan (C5) | `modules/*/variables.tf`, `environments/*/variables.tf`, `outputs.tf` | Añadir descripciones, una `validation` de claves obligatorias y podar outputs. El listado está en `KNOWN_DEBT` de `scripts/quality-check.mjs` | infra |
| **M8** | Baja | `aws_amplify_branch` no lleva la etiqueta `Component`; los recursos manuales usan `Component=infrastructure`, que no figura en [billing-tags.md](billing-tags.md) | `modules/amplify/main.tf`, `docs/billing-tags.md` | Etiquetar la rama y documentar el valor `infrastructure` | infra |
| **M9** | Media | La CI (`ci.yml`) existe, pero **(por confirmar)** si la rama principal exige que pase, exige revisión y tiene activados Dependabot security updates: son ajustes de GitHub que no están en el código ([mantenimiento.md](guias/mantenimiento.md#37-github-ci-plantilla-de-pr-y-ajustes-que-no-están-en-el-código)). El trabajo `trivy config` es **informativo** (`continue-on-error`) hasta limpiar la línea base (S3, S5, S9...); después debe pasar a bloquear. `CODEOWNERS` es una propuesta con el marcador `@equipo-infra` sin sustituir | `.github/` y ajustes de GitHub | Activar la protección de rama, sustituir el marcador, y quitar `continue-on-error` cuando la línea base esté limpia | infra |
| **M10** | Baja | Mejora futura: rol OIDC de solo lectura para publicar el `terraform plan` de preprod en la PR. El `apply` seguirá siendo manual con confirmación expresa | `.github/workflows/ci.yml` | Diseñar el rol con permisos de solo lectura y sin acceso a secretos ([SEG-4](guias/seguridad.md)) | infra |
| **B2** | Baja | El README y las guías mezclan inglés y español | [README](../README.md) | Unificar el idioma (la política es español) | infra |

## Resueltos

Sin commit todavía (los cambios están en el árbol de trabajo de `feature/testing`).

| Id | Hallazgo | Corrección |
|---|---|---|
| **R1** | La tabla del README decía `sigmetum-frontend` para las apps de Amplify, pero el nombre real es `<app_name>-<entorno>` | README: `sigmetum-frontend-dev` y `sigmetum-frontend-prod` |
| **R2** | La tabla de outputs del README no coincidía con ninguno de los outputs reales | README apunta a la [referencia](referencia-modulos.md) |
| **R3** | Las plantillas `terraform.tfvars.example` tenían región `eu-west-3` (incluido el ARN de ACM), buckets con nombre distinto al del README, claves `AWS_ACCESSKEYID` y `AWS_SECRETACCESSKEY` que el backend no lee, un identificador de cuenta real en el ARN y no incluían `ADMIN_*` ni `ALLOWED_ORIGIN` | Plantillas alineadas con la referencia y con el proveedor (`eu-west-1`); el identificador de cuenta pasa a marcador. `docs-check` lo vigila |
| **R4** | Los ejemplos de `terraform.tfvars` del README repetían las plantillas y estaban desactualizados | El README remite a las plantillas |
| **R5** | La numeración de los requisitos previos del README saltaba del 1 al 3 | Renumerados |
| **B1** | `INTEGRACION.md` (raíz) estaba sin confirmar y su enlace de GitHub solo funcionaría al fusionar el frontend | **No procede:** el archivo se eliminó por redundante; los punteros a los documentos de los repositorios hermanos (con la salvedad del enlace de GitHub, por confirmar) están en [mantenimiento.md](guias/mantenimiento.md#31-dónde-vive-cada-cosa) |
