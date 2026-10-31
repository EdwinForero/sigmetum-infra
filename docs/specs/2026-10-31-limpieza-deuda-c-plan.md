# Plan: limpieza de deuda C (M1, M4, M2, M7, S1)

Fecha: 2026-10-31 · Estado: cerrado · Spec: `docs/specs/2026-10-31-limpieza-deuda-c-design.md`

Crítico: sí, por la entrada «contrato con el frontend y el backend (VITE_*, build_spec, app_env_vars)» de `criticidad`: el paso 4 añade una restricción en `app_env_vars` dentro de `areasContrato` (`modules/beanstalk/**` y `environments/**/variables.tf`). El riesgo de recursos es nulo (ninguno cambia); el riesgo real es que el `plan` falle en un entorno cuyos `tfvars` no tengan las nueve claves. No coincide «secretos y terraform.tfvars» en sentido estricto: no se leen `tfvars` ni se tocan valores. Se recomienda segunda opinión sobre el paso 4.

## Decisiones del plan

1. **`modules/networking/variables.tf`: se borra el archivo** (con `rm`; sin `git rm` ni `git add`). Se descarta dejarlo vacío (archivo muerto). `docs-check` y `quality-check` toleran que falte (`hcl()` devuelve vacío). La cifra de archivos `.tf` baja de 28 a 27.
2. **La `validation` usa `keys(var.app_env_vars)` SIN `nonsensitive()`**: Terraform quita las marcas de sensibilidad del resultado de la condición, así que un mapa sensible se puede validar tal cual; `nonsensitive()` sobre un valor no marcado da error en Terraform 1.5-1.7 y el módulo declara `required_version >= 1.5`. Si la prueba del paso 4 diera «condition result is sensitive», se usa `nonsensitive(keys(var.app_env_vars))` (solo las claves, nunca los valores).
3. **El `error_message` es estático** y lista los nombres de las claves. Se descarta un mensaje con las claves que faltan (duplica la expresión y roza la redacción de valores sensibles).
4. **S1 lo hace el tester-documentador**: son `docs/*.md` y el developer no edita documentos; el script es desechable, vive en el scratchpad y no forma parte del repositorio. La retirada de `accountIds` de `KNOWN_DEBT` es código y va al developer (paso 5). Entre ambos, `quality-check` marcará esos dos documentos (esperado).
5. **Validación por nombre, no por contenido**: el backend exige además valor no vacío, pero el ejemplo de `dev` deja `ALLOWED_ORIGIN = ""` en la primera vuelta de `apply`; exigir no vacío rompería ese flujo documentado.
6. **`KNOWN_DEBT` se reduce, no se borra**: el código indexa `KNOWN_DEBT.fmt[...]`, `.noDescription.names` y `.accountIds[...]`; se quedan como `{}`, `names: []` y `{}`. Borrarlas obligaría a tocar la lógica de `quality-check`, fuera de la spec.

## Fase 1: developer (código)

1. **M1: quitar variables sin uso**
   - `environments/dev/variables.tf`: borrar el bloque `variable "ssl_certificate_arn"` (líneas 9-12) y la línea en blanco siguiente. Quedan `notification_email`, `bucket_name`, `github_access_token`, `github_repository` y `app_env_vars`.
   - `modules/networking/variables.tf`: borrar el archivo.
   - `environments/dev/main.tf` y `environments/prod/main.tf`: borrar la línea 3 (`environment = "dev"` / `environment = "prod"`) del módulo `networking`. Resultado en ambos (`terraform fmt` exige el `=` pegado al quedar un solo argumento):
     ```
     module "networking" {
       source = "../../modules/networking"
     }
     ```
   - No se tocan `ssl_certificate_arn` de `environments/prod`, ni la de `modules/beanstalk`.
   - Comprobación: Grep de `ssl_certificate_arn` con glob `*.tf` en `environments/dev` sin resultados (usar siempre glob `*.tf` para no abrir `terraform.tfvars`); Grep de `var.environment` en `modules/networking` sin resultados; `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `environments/dev` y `environments/prod`.
   - Evidencia de que nadie más las usa: `ssl_certificate_arn` de dev solo aparece en `variables.tf` (y en `KNOWN_DEBT`, referencia y estado); `environments/dev/terraform.tfvars.example` no la menciona (la de prod sí, y se queda); `docs-check` solo la busca en el cuerpo del módulo `beanstalk` de prod.

2. **M7: `description` en variables** (la primera línea del bloque; sin cambiar `type`, `default`, `sensitive` ni nombres; `terraform fmt` sobre cada archivo). Las sensibles solo llevan propósito, sin valores.

   | Archivo | Variable: descripción |
   |---|---|
   | `environments/dev/variables.tf` y `environments/prod/variables.tf` (las mismas cinco) | `notification_email`: "Email address that receives the Beanstalk SNS notifications (health, deploy)." |
   | | `bucket_name`: "Globally unique name of the S3 bucket for app data and assets." |
   | | `github_access_token`: "GitHub personal access token that Amplify uses to read the frontend repository." |
   | | `github_repository`: "URL of the frontend GitHub repository that Amplify builds." |
   | | `app_env_vars`: "Application environment variables for the backend process, passed to the beanstalk module. Sensitive; the keys are listed in docs/referencia-modulos.md." |
   | `modules/amplify/variables.tf` | `environment`: "Deployment environment: dev or prod. Forms the app name and the branch stage." |
   | | `app_name`: "Prefix of the Amplify app name; the app is named <app_name>-<environment>." |
   | `modules/beanstalk/variables.tf` | `environment`: "Deployment environment: dev or prod. Forms the Beanstalk application and environment names." |
   | | `instance_type`: "EC2 instance type of the Beanstalk instances." |
   | | `min_instances`: "Minimum number of instances in the Auto Scaling group." |
   | | `max_instances`: "Maximum number of instances in the Auto Scaling group." |
   | | `vpc_id`: "ID of the VPC where the environment is deployed." |
   | | `subnet_ids`: "Subnets for the instances and the load balancer." |
   | | `load_balancer_type`: "'single' (no load balancer, dev) or 'application' (ALB with auto scaling, prod)." |
   | | `notification_email`: "Email address that receives the SNS notifications of the environment." |
   | `modules/storage/variables.tf` | `environment`: "Deployment environment: dev or prod. Used in the names of the OAC and of the S3 access policy." |

   - La `description` de `app_env_vars` del módulo `beanstalk` se amplía en el paso 4. `dns` y `backend-ci-iam` ya las tienen.
   - Comprobación: `node scripts/quality-check.mjs` solo puede quejarse de que `KNOWN_DEBT.noDescription` ya no es deuda (se corrige en el paso 5); `terraform fmt -check -recursive` en verde.

3. **M7: `description` en outputs** (antes de `value`; los comentarios existentes se conservan; `terraform fmt`). No se poda ni se renombra ningún output; `load_balancers` no se toca (M12).

   | Archivo | Output: descripción |
   |---|---|
   | `modules/networking/outputs.tf` | `vpc_id`: "ID of the default VPC." |
   | | `subnet_ids`: "IDs of the default subnets, one per availability zone." |
   | `modules/dns/outputs.tf` | `zone_id`: "ID of the Route53 hosted zone." |
   | | `backend_fqdn`: "Fully qualified name of the backend record (backend.<zone>)." |
   | `modules/amplify/outputs.tf` | `app_id`: "ID of the Amplify app." |
   | | `branch_url`: "URL of the deployed branch on the Amplify default domain; slashes in the branch name become dashes." |
   | `modules/storage/outputs.tf` | `bucket_name`: "Name of the data and assets S3 bucket." |
   | | `bucket_arn`: "ARN of the data and assets S3 bucket." |
   | `modules/beanstalk/outputs.tf` | `environment_name`: "Name of the Beanstalk environment." |
   | | `application_name`: "Name of the Beanstalk application." |
   | `environments/dev/outputs.tf` | `beanstalk_url`: "Beanstalk environment endpoint (CNAME, no scheme)." |
   | | `backend_cdn_url`: "CloudFront HTTPS URL of the backend (dev only), used as the frontend backend_url." |
   | | `amplify_url`: "URL of the deployed Amplify branch." |
   | | `s3_bucket`: "Name of the S3 bucket." |
   | | `cdn_url`: "CloudFront HTTPS URL for the public frontend assets." |
   | `environments/prod/outputs.tf` | `beanstalk_url`: "Beanstalk environment endpoint (CNAME, no scheme)." |
   | | `backend_fqdn`: "Route53 domain name of the backend." |
   | | `amplify_url`: "URL of the deployed Amplify branch." |
   | | `s3_bucket`: "Name of the S3 bucket." |

   - Comprobación: en cada `outputs.tf` de módulos y entornos, el recuento de `^output "` es igual al de `^\s*description\s*=` (Grep en modo `count`). `quality-check` no vigila las descripciones de outputs, así que esta es la única comprobación.

4. **M7: `validation` de `app_env_vars` (crítico)**
   - Archivo: `modules/beanstalk/variables.tf` (solo ahí). HCL exacto del bloque (se amplía la `description`; `type`, `sensitive` y `default` no cambian):
   ```hcl
   variable "app_env_vars" {
     description = "Application environment variables passed to the Node.js process. Must define every key the backend requires at startup; extra keys are allowed."
     type        = map(string)
     sensitive   = true
     default     = {}

     validation {
       condition = alltrue([
         for key in ["JWT_SECRET", "JWT_EXPIRATION", "ADMIN_USERNAME", "ADMIN_PASSWORD", "EMAIL", "EMAIL_PASSWORD", "AWS_REGION", "AWS_BUCKET_NAME", "ALLOWED_ORIGIN"] : contains(keys(var.app_env_vars), key)
       ])
       error_message = "app_env_vars must define the keys the backend requires at startup: JWT_SECRET, JWT_EXPIRATION, ADMIN_USERNAME, ADMIN_PASSWORD, EMAIL, EMAIL_PASSWORD, AWS_REGION, AWS_BUCKET_NAME and ALLOWED_ORIGIN."
     }
   }
   ```
   - Comportamiento: acepta claves extra (`PORT`, `TRUST_PROXY_HOPS`...); un mapa vacío falla; la condición y el mensaje solo contienen nombres; `for_each = nonsensitive(var.app_env_vars)` del módulo no cambia. Tras escribirlo, `terraform fmt modules/beanstalk/variables.tf` y conservar su layout.
   - Comprobación:
     - (a) `terraform validate` en dev y prod en verde. NO prueba la condición: `app_env_vars = var.app_env_vars` llega desconocida al módulo y la validación se omite.
     - (b) Prueba desechable en `C:\Users\edwin\AppData\Local\Temp\claude\c--Users-edwin-Music-Repos-sigmetum-infra\4cdafec7-5141-4608-812b-0dbb1dfd9dde\scratchpad\validation-test`, sin tocar el repo, con un script Node guardado en el scratchpad: extrae del `variables.tf` REAL el bloque `variable "app_env_vars"` y lo escribe en `<casos>/<caso>/m/variables.tf`; lee los NOMBRES de clave de `app_env_vars` de `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example` (misma expresión regular que `docs-check`) y genera cuatro casos, cada uno con un `main.tf` con `module "t" { source = "./m"  app_env_vars = { <CLAVE> = "x", ... } }` (valores ficticios): `pos-dev` (debe dar «Success»), `pos-prod` (debe dar «Success»), `neg-faltante` (las de dev menos `ALLOWED_ORIGIN`: DEBE FALLAR con el mensaje) y `neg-vacio` (`{}`: DEBE FALLAR). En cada caso, `terraform init -backend=false -input=false` y `terraform validate` (módulo local, sin proveedores ni red). Imprime solo caso, código de salida y la línea «Error:» si existe, nunca el contenido de los `.tfvars`. Registrar también `terraform version`. Si los dos casos negativos NO fallan, `validate` no evalúa la condición con constantes: se anota y la comprobación queda solo en (c). Si fallan con «sensitive», aplicar la alternativa de la decisión 2.
     - (c) (por confirmar): el `terraform plan` del humano en dev y prod con sus `tfvars` reales.
   - Norma: `buenas-practicas-terraform.md` (`validation` donde hay valores sin sentido); `seguridad.md` (nada de valores en mensajes); `para-backend.md` sección 2 y `../sigmetum-backend/config/validateEnv.js`, lista `required`.

5. **M4, M7 y S1: deuda en `scripts/quality-check.mjs`** (objeto `KNOWN_DEBT`, líneas 37-69)
   - `fmt` pasa a `{}`; el comentario indica que no queda ningún archivo con deuda de formato.
   - `noDescription` pasa a `{ id: 'M7', names: [] }`; se mantiene `id` y se eliminan las entradas de `names`.
   - `accountIds` pasa a `{}`; el comentario indica que no queda ningún documento con identificadores.
   - Nada más del script cambia y no se añade ninguna comprobación nueva. Los siete outputs sin consumidor NO entran en `KNOWN_DEBT` (`quality-check` no tiene regla para ellos): solo se registran en el estado.
   - Comprobación: `node scripts/quality-check.mjs`: el único problema aceptable en este momento son las dos líneas de «doce dígitos» de `docs/aws-cli-setup.md` y `docs/aws-organizations-setup.md` (se resuelven en el tester, punto 1); `terraform fmt -check -recursive` y `validate` (dev y prod) en verde; `node scripts/docs-check.mjs` fallará hasta que el tester actualice métricas y referencia (esperado).

## A cargo del tester-documentador

1. **S1 con script desechable, sin imprimir identificadores.** `docs/aws-cli-setup.md` y `docs/aws-organizations-setup.md`: tres identificadores distintos y nueve apariciones; mapeo comprobado por contexto, línea a línea:

   | Archivo (líneas) | Marcador |
   |---|---|
   | `aws-cli-setup.md` L24 | `<ID_CUENTA_GESTION>` (cuenta management) |
   | `aws-cli-setup.md` L86, L116 | `<ID_CUENTA_DEV>` (rotuladas `sigmetum-preprod`) |
   | `aws-cli-setup.md` L104, L122 | `<ID_CUENTA_PROD>` (rotuladas `sigmetum-prod`) |
   | `aws-organizations-setup.md` L6, L48 | `<ID_CUENTA_GESTION>` |
   | `aws-organizations-setup.md` L91 | `<ID_CUENTA_DEV>` (fila `sigmetum-preprod`) |
   | `aws-organizations-setup.md` L92 | `<ID_CUENTA_PROD>` (fila `sigmetum-prod`) |

   - Método: script Node en `...\scratchpad\s1-markers.mjs` que lee cada archivo con `readFileSync(..., 'utf8')`, sin normalizar saltos de línea (puede haber CRLF), y parte por `\n`. Para cada (archivo, línea) de la tabla exige exactamente una coincidencia de `/\b\d{12}\b/` y la sustituye por el marcador. Aborta SIN escribir si otra línea contiene un número de doce dígitos, si un identificador se asigna a dos marcadores, si dos identificadores comparten marcador o si los distintos no son exactamente tres. Admite `--dry` (solo comprueba). Imprime únicamente recuentos (sustituciones por archivo, por marcador, número de identificadores distintos y coincidencias residuales); nunca imprime una línea del documento.
   - Comprobaciones: primero `--dry`, luego real; Grep `\b[0-9]{12}\b` en los dos archivos, en modo `count`: cero; `git diff --numstat` de esos dos archivos con las líneas cambiadas esperadas (**no ejecutar `git diff` sin `--numstat`: imprimiría las líneas con los identificadores**); `node scripts/quality-check.mjs` ya no cita esos dos archivos.
   - Efecto en las guías: las líneas de plantilla con `<ID_CUENTA_DEV>` y `<ID_CUENTA_PROD>` son valores que la persona debe sustituir; no se añade ninguna nota explicativa (la spec dice «sin tocar nada más»).

2. **`docs/estado-y-deuda-tecnica.md`.**
   - Métricas: archivos `.tf` de 28 a 27 y variables de módulos de 32 a 31; confirmar con `node scripts/docs-check.mjs --metrics` (el resto no cambia).
   - M1, M4 y S1 a «Resueltos». M2 a «Resueltos» como «no afecta» a la compilación en `dev` (build #7: Vite 6.4.3, `building for production`, sin avisos de `NODE_ENV`); efecto en `prod` (por confirmar).
   - M7 a «Resueltos»: descripciones completas, una `validation` en `app_env_vars` de `modules/beanstalk`, y los siete outputs sin consumidor mantenidos (`storage:bucket_arn`, `beanstalk:environment_name`, `beanstalk:application_name`, `beanstalk:load_balancers`, `amplify:app_id`, `amplify:default_domain`, `dns:zone_id`), sin entrada en `KNOWN_DEBT`.
   - Anotar: la validación pasa `terraform validate` pero solo se evalúa con los `tfvars` reales en el `plan` del humano (por confirmar), y el resultado de la prueba del scratchpad.
   - «Última actualización: 31/10/2026». Actualizar el párrafo de «Esta revisión», añadir una fila en «Iteraciones» y anotar el hallazgo del frontend (vulnerabilidades tras `npm ci` y tamaño del bundle, repositorio `sigmetum-frontend`).

3. **`docs/referencia-modulos.md`.** Módulo networking: la tabla de variables se sustituye por «Sin variables.». Entorno dev: quitar la fila `ssl_certificate_arn`. Módulo beanstalk, fila `app_env_vars`: añadir que exige en `plan` las nueve claves obligatorias y acepta extras. Sección `app_env_vars`: una frase equivalente. Línea de `NODE_ENV`: sin cambio de contenido; solo confirmar que coincide con el código. Los outputs no cambian. Escribir «nueve» y no la cifra seguida de la palabra «claves» (cifra volátil).

4. **`docs/guias/buenas-practicas-terraform.md`** (líneas 18, 25, 32, 88, 106, 108, 109, 118 y 125: quitar o actualizar las menciones de M1, M4, M2 y M7 y el estado de variables con `description` y `validation`) y **`docs/guias/seguridad.md`** (líneas 28 y 131: S1, ya no hay identificadores en las guías).

5. **`docs/integracion/para-frontend.md`** (línea de `NODE_ENV`): añadir solo que M2 se cerró como «no afecta» en `dev` (efecto en `prod` por confirmar). **`docs/integracion/para-backend.md`, sección 2:** una frase indicando que `app_env_vars` se valida en `plan` (nombres, no valores) con las nueve obligatorias de `validateEnv`. Lo exige `docsPorArea` de `modules/beanstalk/**`; no cambia el contrato.

6. **`README.md` y avisos.** Fila de la tabla de iteraciones con enlaces a la spec, el plan y el aviso de PR (`docs-check` exige que todo `docs/**/*.md` esté enlazado desde el README con la forma `(docs/specs/...`). Aviso de PR `docs/specs/2026-10-31-limpieza-deuda-c-aviso-pr.md`: qué debe mirar el humano en el `plan`, el orden de despliegue y la sección «Frontend y backend» de la plantilla. Cierre: `node scripts/docs-check.mjs`, `node scripts/quality-check.mjs`, `terraform fmt -check -recursive`, `validate` (dev y prod) y `node plugins/ciclo-agentico/scripts/docs-gate.mjs` (este último lo ejecuta el orquestador). No hace falta `node --test` (`plugins/` no se toca). **Cuidado con las cifras volátiles**: `docs-check` rechaza una cifra seguida de «módulos, variables, outputs, archivos, claves, recursos o entornos» en `docs/specs` y en los documentos; escribir con letras.

## Pruebas

- Sin pruebas automáticas nuevas: este repositorio no tiene pruebas de la infraestructura. La prueba desechable de la `validation` (paso 4) vive en el scratchpad y no se versiona.
- Verificación de `.claude/flujo.json`: `fmt`, `validate:dev`, `validate:prod`, `quality`, `docs:check`, `docs:gate`.

## Qué mira el humano en `terraform plan` (dev y prod; no pegar la salida)

- Esperado: «No changes» en los dos entornos. Si aparece cualquier recurso a crear, cambiar o destruir, parar y revisar: no es lo previsto.
- La `validation` puede fallar con «Invalid value for variable... app_env_vars» (módulo `beanstalk`) si su `terraform.tfvars` no define alguna de las nueve claves. El mensaje solo lista nombres. Se corrige en el `tfvars` (fuera de git), no en el código.
- Riesgo (no leído, por diseño): si el `terraform.tfvars` de dev aún define `ssl_certificate_arn`, Terraform avisa «Value for undeclared variable». Es un aviso, no un error; se puede quitar esa línea.
- Con la validación solo se puede comprobar antes del `plan` la sintaxis y los nombres de los ejemplos. La comprobación real con valores reales queda (por confirmar) en el `plan`.

## Orden de despliegue para los otros repositorios

Ninguno. El frontend y el backend no tienen que hacer nada, salvo la nota del frontend sobre `npm audit` y el tamaño del bundle (fuera de alcance de este repositorio).

## Hallazgos fuera de la spec

- A. La spec rompía `docs-check` por cifras volátiles; el orquestador la reescribió con letras (cambio de redacción, sin cambiar el sentido).
- B. Enlazar spec, plan y aviso de PR en el README (ya incluido en el punto 6 del tester).
- C. Más líneas de guías afectadas de las que cita la spec (incluidas en el punto 4 del tester).
- D. `quality-check` no vigila las `description` de outputs, solo las de variables; una regla nueva ampliaría la spec. Propuesta, no incluida.
- E. La validación es por nombre; el backend también rechaza valores vacíos y el ejemplo de dev deja `ALLOWED_ORIGIN` vacío en la primera vuelta (decisión 5).
- F. `required_version >= 1.5`: el comportamiento de la `validation` con mapa sensible se comprueba con la versión instalada (se registra), no con la 1.5 (por confirmar).

## Cierre

- Documentos de integración afectados: `para-backend.md` (una frase en la sección 2) y `para-frontend.md` (una frase sobre `NODE_ENV`). Ninguno cambia el contrato.
- Segunda opinión: se pide sobre este plan (con foco en el paso 4) y sobre el diff.
