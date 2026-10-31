# Dominio de prod, cabeceras de Amplify y subida de assets: plan

Fecha: 2026-10-31 · Estado: cerrado · Spec: `docs/specs/2026-10-31-dominio-cabeceras-assets-design.md`

Crítico: sí. Entradas de `criticidad`: "red y TLS" (dominio propio, certificado, HSTS) y "contrato con el frontend y el backend (VITE_*, build_spec, app_env_vars)" (dominios y `ALLOWED_ORIGIN`).

Nota del architect: no pudo consultar context7 ni WebSearch; verificó en el binario del proveedor fijado (aws 5.100.0, `~> 5.0`) que existen `custom_headers`, `wait_for_verification` y `enable_auto_sub_domain`. El resto de lo que dice del proveedor y de Amplify va como (por confirmar).

## Decisiones del plan

1. **Variable de dominios `custom_domains`, `map(list(string))`** (dominio raíz => prefijos; `""` es el apex). Default `{}`: dev no toca su `main.tf`. Descartadas: dos variables `apex`/`www` y un `list(object)` con `for_each` por dominio completo (Amplify asocia por dominio raíz, con varios `sub_domain` en un recurso). Hay que explicar la diferencia dev/prod en el README (BP-1).
2. **`wait_for_verification = false`**: con `true`, un `apply` se queda esperando si la validación DNS no cierra. El humano comprueba el estado en la consola de Amplify o con `aws amplify get-domain-association` (solo lectura).
3. **`branch_url` no cambia** (sigue siendo la URL del dominio por defecto, que sigue activa). En prod, `amplify_url` deja de servir para `ALLOWED_ORIGIN`.
4. **Sin choque con la regla SPA**: `custom_rule` es de la app y vale para todos los dominios. No se toca `build_spec`, `custom_rule` ni `aws_amplify_branch`.
5. **CSP calculada** con `var.s3_url`, `var.backend_url` y `data.aws_region`: sin orígenes ni región hardcodeados; dev y prod salen distintos solos.

## Directivas CSP derivadas del código real del frontend

| Directiva | Valor | Evidencia |
|---|---|---|
| `default-src` | `'self'` | base |
| `script-src` | `'self'` | Vite emite JS externo; sin `'unsafe-inline'` a propósito |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Google Fonts en `index.html` y `styled-components`; `'unsafe-inline'` (por confirmar): Amplify no puede generar nonces |
| `font-src` | `'self' https://fonts.gstatic.com` | Amaranth, Sen y Material Symbols |
| `img-src` | `'self'` + `var.s3_url` + `https://*.s3.<región>.amazonaws.com` | logos y banner por `assetUrl` (CloudFront); galería con URLs prefirmadas, formato virtual-hosted por defecto (por confirmar) |
| `connect-src` | `'self'` + `var.backend_url` | único `fetch`: `services/api.js` |
| `object-src` / `base-uri` / `form-action` / `frame-ancestors` | `'none'` / `'self'` / `'self'` / `'none'` | SEG-9 pide `frame-ancestors`; sin iframes |

Sin `data:` ni `blob:` (sin evidencia); sin `via.placeholder.com` (`ImageCarrousel` está comentado). **Se espera una violación desde el primer día**: `index.html` usa `onload="this.rel='stylesheet'"` en dos `<link rel="preload">` (manejador inline). Lo debe corregir el frontend antes de endurecer la CSP.

## Fase 1

1. **Dominios en `modules/amplify`**
   - Archivos: `modules/amplify/variables.tf` y `modules/amplify/main.tf` (modificar).
   - Al final de `variables.tf`:
   ```hcl
   variable "custom_domains" {
     description = "Custom domains for the deployed branch: root domain name => subdomain prefixes (\"\" is the apex, \"www\" is www.<root>). Empty creates no domain association."
     type        = map(list(string))
     default     = {}

     validation {
       condition     = alltrue([for domain in keys(var.custom_domains) : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", domain))])
       error_message = "custom_domains keys must be bare lower-case domain names (no scheme, path or port), for example example.org."
     }
   }
   ```
   - En `main.tf`, tras `aws_amplify_branch.this` (sin `tags`: el recurso no los admite, por confirmar, y no está en `TAGGABLE` de `quality-check`):
   ```hcl
   # One association per root domain; Amplify manages the certificate (DNS validation).
   # Not waiting for verification keeps apply from hanging if DNS validation is slow.
   resource "aws_amplify_domain_association" "this" {
     for_each = var.custom_domains

     app_id                = aws_amplify_app.this.id
     domain_name           = each.key
     wait_for_verification = false

     dynamic "sub_domain" {
       for_each = toset(each.value)

       content {
         branch_name = aws_amplify_branch.this.branch_name
         prefix      = sub_domain.value
       }
     }
   }
   ```
   - Comprobación: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en dev y prod; `Grep` de `http://` y de 12 dígitos en los `.tf` tocados: cero. `prefix = ""` para el apex sale del ejemplo de la documentación del proveedor, de memoria (por confirmar).
   - Norma: BP-2 y BP-10; SEG-8 y SEG-1; `para-frontend.md` sección 2 "Dominios".

2. **Cabeceras de seguridad y caché (`custom_headers`)**
   - Archivo: `modules/amplify/main.tf`. `data` y `locals` antes del recurso `aws_amplify_app`; `docs-check` busca `resource "aws_amplify_app" "this" {` seguido de `name =`: no insertar nada entre ambos.
   - Antes del recurso:
   ```hcl
   data "aws_region" "current" {}

   locals {
     # Report-Only: the browser logs violations in its console and blocks nothing
     csp_report_only = join("; ", [
       "default-src 'self'",
       "script-src 'self'",
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
       "font-src 'self' https://fonts.gstatic.com",
       "img-src ${join(" ", compact(["'self'", var.s3_url, "https://*.s3.${data.aws_region.current.name}.amazonaws.com"]))}",
       "connect-src ${join(" ", compact(["'self'", var.backend_url]))}",
       "object-src 'none'",
       "base-uri 'self'",
       "form-action 'self'",
       "frame-ancestors 'none'",
     ])
   }
   ```
   - Dentro de `aws_amplify_app.this`, tras `build_spec` (sin comentarios `#` dentro del YAML: `stripComments` de los scripts los borraría):
   ```hcl
     custom_headers = <<-EOT
       customHeaders:
         - pattern: '**'
           headers:
             - key: Strict-Transport-Security
               value: "max-age=86400"
             - key: X-Content-Type-Options
               value: "nosniff"
             - key: Referrer-Policy
               value: "strict-origin-when-cross-origin"
             - key: Permissions-Policy
               value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
             - key: Content-Security-Policy-Report-Only
               value: "${local.csp_report_only}"
         - pattern: /index.html
           headers:
             - key: Cache-Control
               value: "no-cache"
         - pattern: /assets/*
           headers:
             - key: Cache-Control
               value: "public, max-age=31536000, immutable"
     EOT
   ```
   - Valores: HSTS `max-age=86400` sin `includeSubDomains` ni `preload`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` sin cámara, micrófono ni geolocalización (el frontend no usa esas APIs); solo existe `Content-Security-Policy-Report-Only`. Solo `**` lleva las cabeceras de seguridad; `Cache-Control` aparece solo en `/index.html` y `/assets/*`, que son disjuntos. `/assets/*` afecta al `dist/assets/` de Vite, no a los ficheros del bucket (otro origen, CloudFront).
   - Comprobación: `fmt -check -recursive` y `validate` en dev y prod. `validate` no ve el YAML: el developer ejecuta un script desechable en el scratchpad (`C:\Users\edwin\AppData\Local\Temp\claude\c--Users-edwin-Music-Repos-sigmetum-infra\4cdafec7-5141-4608-812b-0dbb1dfd9dde\scratchpad\check-headers.mjs`, no se versiona) que extrae el heredoc de `modules/amplify/main.tf` y comprueba: primera línea `customHeaders:`; sin tabuladores y toda sangría múltiplo de 2; tantas líneas `- key:` como `value:`; exactamente 3 `- pattern:`; ninguna clave `Content-Security-Policy` sin `-Report-Only`; valores entre comillas dobles; debe imprimir `ok`. Comprobar a ojo que `terraform fmt` no reindentó el heredoc. La comprobación real es `curl -I` del humano tras el `apply`.
   - Norma: SEG-9 y SEG-8; `para-frontend.md` sección 2 "Cabeceras". El `build_spec`, las `custom_rule` y las `environment_variables` quedan idénticos.

3. **Prod compone el dominio y la plantilla documenta el formato**
   - Archivos: `environments/prod/main.tf` y `environments/prod/terraform.tfvars.example` (solo el comentario). `environments/dev/main.tf` no se toca.
   - Al final del bloque `module "amplify"` de prod, tras `s3_url` y una línea en blanco:
   ```hcl
     # Apex and www serve the same app from master; both must be in ALLOWED_ORIGIN (deploy the backend first)
     custom_domains = {
       "sigmetum-a.org" = ["", "www"]
     }
   ```
   - El literal `sigmetum-a.org` duplica el de `module "dns"`; aceptable con un solo valor posible (BP-1) y la zona no es secreto.
   - En `terraform.tfvars.example` de prod, sustituir solo el comentario de `ALLOWED_ORIGIN` (líneas 49 a 51) por texto como: "Formato: dos orígenes https separados por coma, sin barra final ni espacios obligatorios: https://<dominio>,https://www.<dominio>. El backend compara cada origen de forma exacta." No tocar el valor `"https://CHANGE_ME_frontend_origin"` ni `app_env_vars`. No leer `terraform.tfvars`.
   - Comprobación: `fmt -check -recursive` y `validate` en prod y dev; `node scripts/docs-check.mjs` (las claves del `.example` siguen coincidiendo); `git diff` de `environments/dev/` vacío.
   - Norma: `para-backend.md` sección 7; `app.js` del backend parte `ALLOWED_ORIGIN` por `,`, hace `trim` y compara con `includes`, sin barra final, sensible a mayúsculas; `validateEnv.js` solo exige que exista.

4. **Script `scripts/sync-assets.mjs`**
   - Archivo: `scripts/sync-assets.mjs` (crear). Exporta `parseOptions(argv)`, `buildArgs(options)` y `main(argv, { run, out, err })`; solo se ejecuta si es el módulo principal.
   - Diseño: subida real por defecto y `--dryrun` para simular; la primera línea que imprime es el comando exacto; el origen es el contenido de `assets/` (no la carpeta que lo contiene), destino fijo `s3://<bucket>/assets/`; sin `--delete` (`parseArgs` estricto rechaza opciones no declaradas); `execFile` sin shell; bucket y perfil se validan con expresión regular y no pueden empezar por `-`; sin valores por defecto.
   - Código exacto (sin números de 12 dígitos ni ARN, para pasar `quality-check`):
   ```js
   // Sube los recursos estáticos de la web (assets/…) al bucket de un entorno con `aws s3 sync`.
   // Uso: node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket> --profile <perfil> [--region <región>] [--dryrun]
   //      node scripts/sync-assets.mjs --help
   // La carpeta de origen es el CONTENIDO de assets/ (logos/, banners/…); el destino es siempre s3://<bucket>/assets/.
   // Nunca usa --delete: no borra nada del bucket. Sin --dryrun sube de verdad: ejecuta antes con --dryrun y revisa la salida.
   // Necesita la AWS CLI v2 y la sesión abierta (aws sso login --profile <perfil>). Sin dependencias, sin valores por defecto de
   // carpeta, bucket ni perfil, y sin leer credenciales ni terraform.tfvars. La subida real la hace una persona.

   import { execFile } from 'node:child_process';
   import { readdirSync, statSync } from 'node:fs';
   import { resolve } from 'node:path';
   import { pathToFileURL } from 'node:url';
   import { parseArgs, promisify } from 'node:util';

   const execFileAsync = promisify(execFile);

   const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
   const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@+=,-]*$/;
   const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

   export const USAGE = `Uso: node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket> --profile <perfil> [--region <región>] [--dryrun]
     --source   carpeta con el contenido de assets/ (obligatoria)
     --bucket   nombre del bucket de S3 del entorno (obligatorio)
     --profile  perfil de AWS (obligatorio)
     --region   región, si el perfil no la define
     --dryrun   simula la subida sin escribir nada
     --help     muestra esta ayuda`;

   export const parseOptions = (argv) => {
     const { values } = parseArgs({
       args: argv,
       allowPositionals: false,
       strict: true,
       options: {
         source: { type: 'string' },
         bucket: { type: 'string' },
         profile: { type: 'string' },
         region: { type: 'string' },
         dryrun: { type: 'boolean', default: false },
         help: { type: 'boolean', default: false },
       },
     });
     if (values.help) return { help: true };
     for (const name of ['source', 'bucket', 'profile']) if (!values[name]) throw new Error(`Falta --${name}.`);
     if (values.source.startsWith('-')) throw new Error('--source no es una ruta válida.');
     if (!BUCKET.test(values.bucket)) throw new Error('--bucket no parece un nombre de bucket de S3 válido.');
     if (!PROFILE.test(values.profile)) throw new Error('--profile contiene caracteres no permitidos.');
     if (values.region !== undefined && !REGION.test(values.region)) throw new Error('--region no parece una región de AWS válida.');
     const source = resolve(values.source);
     let stats;
     try {
       stats = statSync(source);
     } catch {
       throw new Error('La carpeta --source no existe.');
     }
     if (!stats.isDirectory()) throw new Error('--source debe ser una carpeta.');
     if (readdirSync(source).length === 0) throw new Error('La carpeta --source está vacía.');
     return { source, bucket: values.bucket, profile: values.profile, region: values.region, dryrun: values.dryrun };
   };

   export const buildArgs = ({ source, bucket, profile, region, dryrun }) => [
     's3',
     'sync',
     source,
     `s3://${bucket}/assets/`,
     '--profile',
     profile,
     ...(region ? ['--region', region] : []),
     ...(dryrun ? ['--dryrun'] : []),
   ];

   export const main = async (argv, { run = execFileAsync, out = console.log, err = console.error } = {}) => {
     let options;
     try {
       options = parseOptions(argv);
     } catch (error) {
       err(`Error: ${error.message}\n\n${USAGE}`);
       return 2;
     }
     if (options.help) {
       out(USAGE);
       return 0;
     }
     const args = buildArgs(options);
     out(`aws ${args.join(' ')}`);
     try {
       const { stdout, stderr } = await run('aws', args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
       if (stdout) out(stdout.trimEnd());
       if (stderr) err(stderr.trimEnd());
       return 0;
     } catch (error) {
       if (error.code === 'ENOENT') err('No se encontró la AWS CLI (aws). Instálala y abre la sesión con aws sso login.');
       else {
         if (error.stdout) out(String(error.stdout).trimEnd());
         err(String(error.stderr || error.message).trimEnd());
       }
       return 1;
     }
   };

   if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
     process.exitCode = await main(process.argv.slice(2));
   }
   ```
   - En Windows, `execFile('aws', …)` sin shell funciona con `aws.exe` (instalador oficial de la CLI v2) y no con un `.cmd` (por confirmar).
   - Comprobación: `node scripts/sync-assets.mjs --help` sale con código 0 sin tocar AWS. Más lo del paso 5.
   - Norma: SEG-1 (sin secretos ni cuentas); `mantenimiento.md` sección 7 (estilo). Script, no recurso de Terraform.

5. **Pruebas del script, sin AWS**
   - Archivo: `scripts/sync-assets.test.mjs` (crear). `node:test` y `node:assert/strict`, con `mkdtempSync` en `os.tmpdir()` para el origen (con un fichero dentro). La función `run` es una inyección falsa que guarda los argumentos; no hay riesgo de llegar a AWS.
   - Casos: (1) `--help` devuelve 0, imprime el uso y no llama a `run`; (2 a 4) falta `--source`, `--bucket` o `--profile`: devuelve 2; (5) bucket con mayúsculas, con `;` o con `s3://`: devuelve 2; (6) perfil que empieza por `-`: devuelve 2; (7) origen inexistente, origen que es un fichero y origen vacío: devuelve 2; (8) `--delete` y un argumento posicional extra: devuelven 2; (9) llamada válida: `run` recibe `'aws'` y exactamente `['s3','sync',<ruta absoluta>,'s3://<bucket>/assets/','--profile',<perfil>]`; (10) con `--dryrun` el array termina en `'--dryrun'`; (11) en ningún caso aparece `--delete`; (12) un `run` que lanza un error con `code: 'ENOENT'` hace que `main` devuelva 1; (13) un `run` que falla con `stderr` hace que `main` devuelva 1.
   - Comprobación: `node --test scripts/sync-assets.test.mjs` en verde; después `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs`, que escanean `scripts/`. Sin números de 12 dígitos ni `arn:` en las pruebas: usar `sigmetum-test-bucket` y `test-profile`.
   - Decisión: la prueba vive en `scripts/`, no en `plugins/`; el comando de `plugins/` no la recoge y no se añade a la CI ni a `CLAUDE.md` (para no tocar los tres sitios de la definición de terminado); se documenta en `mantenimiento.md` como comprobación opcional.
   - Sin entrada nueva en `quality-check`, `docs-check` ni `docsPorArea`: `scripts/**` ya pide `mantenimiento.md` y ambos scripts ya escanean `scripts/`.

## A cargo del tester-documentador

1. `docs/referencia-modulos.md`: módulo amplify, tabla Variables: fila `custom_domains`, tipo `map(list(string))`, por defecto `{}` (no `—`, o `docs-check` falla); descripción del módulo (dominio opcional y cabeceras); entorno prod: `custom_domains` fijo.
2. `README.md`: `docs-check` compara la celda `DNS` de la tabla de recursos con exactamente `backend.sigmetum-a.org`: **no cambiar esa celda**; añadir una fila nueva (p. ej. "Frontend domain") con `—` en dev y los dos dominios en prod; explicar la diferencia dev/prod.
3. `docs/integracion/para-frontend.md`: infra:C9 y C11 a "Resuelto en código" (efecto en AWS por confirmar hasta el `apply`); infra:C7 a "procedimiento disponible", pendiente de la subida a prod; secciones "Cabeceras", "Dominios" y "Orden de despliegue" al día; procedimiento de C7 (obtener los 12 ficheros de `assets/` de dev, único sitio verificado donde existen, fuente de verdad por confirmar; carpeta local con `logos/…`, `banners/…`; `--dryrun`; subida real por el humano; lista contrastada con `src/config/assets.js`); aclarar que `assets/*` de las cabeceras es el de Vite y no el del bucket; tarea para el frontend: revisar la consola por avisos de CSP y arreglar el `onload` inline antes de endurecer.
4. `docs/integracion/para-backend.md`: sección 7 y fila de prod: `ALLOWED_ORIGIN` = `https://<dominio>,https://www.<dominio>`, solo marcadores, sin barra final, comparación exacta; el backend se aplica antes.
5. `docs/estado-y-deuda-tecnica.md` (C7, C9 y C11 con fecha de hoy y cifras de `docs-check --metrics`), `docs/guias/seguridad.md` (SEG-9 y su tabla de estado: cabeceras definidas, CSP solo en Report-Only; SEG-8: HSTS de un día sin `includeSubDomains` ni `preload`; fila de TLS), `docs/guias/mantenimiento.md` (fila nueva en la sección 2 "Un script nuevo en scripts/" y mención en la sección 4 de `sync-assets.mjs` y su prueba opcional `node --test scripts/sync-assets.test.mjs`) y el aviso de PR `docs/specs/2026-10-31-dominio-cabeceras-assets-aviso-pr.md`, con qué debe hacer cada repositorio y el orden.

## Pruebas

- Nuevas: `scripts/sync-assets.test.mjs`. No se modifica nada de `plugins/`.
- Definición de terminado: `terraform fmt -check -recursive`; `terraform validate` en dev y prod; `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs` (lo ejecuta el orquestador).

## Qué mira el humano en el `plan` (nadie del ciclo lo ejecuta; no pegar su salida)

1. **dev:** solo `aws_amplify_app.this` con update in-place de `custom_headers`; ningún `aws_amplify_domain_association`; sin cambios en `custom_rule`, `build_spec`, `environment_variables` ni `aws_amplify_branch`.
2. **prod:** lo mismo en la app, más 1 recurso creado: `aws_amplify_domain_association.this["sigmetum-a.org"]`; nada en `module.dns`, `module.beanstalk` ni `module.storage`.
3. Cualquier `destroy` o `replace` es motivo de parar (especialmente `aws_amplify_app`, `aws_amplify_branch` y el bucket).
4. Tras el `apply`: relanzar el build de la rama (las cabeceras probablemente solo se aplican en el siguiente despliegue, por confirmar); `curl -I` a `/`, `/index.html`, `/explorar` y un fichero de `/assets/*`: deben salir HSTS, nosniff, Referrer-Policy, Permissions-Policy y `Content-Security-Policy-Report-Only`, `Cache-Control: no-cache` en `index.html`, `public, max-age=31536000, immutable` en `/assets/*` y ninguna `Content-Security-Policy` bloqueante; si `/explorar` no sale con `no-cache` o `/assets/*` no cubre ficheros anidados, ampliar el patrón (por confirmar); estado del dominio en la consola de Amplify o con `aws amplify get-domain-association` (solo lectura).

## Orden de despliegue

1. Humano: añadir los dos orígenes a `ALLOWED_ORIGIN` en el `terraform.tfvars` de prod y aplicar el backend primero.
2. Confirmar la zona `sigmetum-a.org` en Route53 de la cuenta de prod, delegada en el registrador, y que no haya registros previos para el apex ni `www` (por confirmar).
3. `apply` en dev y comprobar las cabeceras. Después `apply` en prod con el dominio.
4. Esperar la validación del certificado y que el dominio quede activo; relanzar el build de `master` si hace falta.
5. Subir los assets de prod con `--dryrun` y luego sin él. Comprobar la sección 8 de `para-infra.md` y la consola del navegador por avisos de CSP.
- Frontend: sin cambios de código obligatorios; revisar los avisos de CSP y el `onload` inline antes de endurecer. Backend: sin cambios de código, solo el valor de `ALLOWED_ORIGIN` en prod.

## Fase 2 (añadida tras la decisión 5 de la spec: registros de Route53 en este ciclo)

El architect no pudo consultar context7 ni WebSearch en este rol: todo lo del proveedor aws 5.x va de memoria y marcado (por confirmar). Los pasos 1 a 5 no cambian. Este paso cierra el hallazgo 2 de abajo ("Registros DNS del dominio").

### Decisiones resueltas

1. **Dónde viven y de dónde sale la zona:** en `modules/amplify`, junto a la asociación; la zona se obtiene con `data "aws_route53_zone"` por el nombre del dominio raíz, un data source por clave de `custom_domains`. Sin variable nueva y sin cambios en `environments/prod` ni en `modules/dns` (sigue cumpliéndose que `modules/dns` no cambia). Sin ciclo de módulos: `modules/amplify` solo depende de `module.storage`; `modules/dns` depende de `module.beanstalk`. Descartadas: `modules/dns` o `environments/prod` (`module.dns` recibiría salidas de `amplify` y cambiaría) y una variable `zone_id` (`custom_domains` admite varios dominios raíz). Supuesto: la zona pública se llama igual que el dominio raíz y está en la cuenta donde se aplica; si no existe, el `plan` falla con "no matching Route53Zone found" (comprobación temprana).
2. **Parseo y `plan` sin valores conocidos:** todas las claves de `for_each` salen de `var.custom_domains` (dominio, prefijo, `fqdn`), nunca de atributos del recurso; solo `name` y `records` son "known after apply". `split("CNAME", valor)` en vez de `split(" ", …)` (el apex llega con prefijo vacío), con `trimspace` y `trimsuffix(..., ".")`. Si el formato no es el esperado, el índice `[1]` falla con error claro en el `apply`. Riesgo (por confirmar): con `wait_for_verification = false` Amplify puede devolver vacíos los campos DNS al crear; si pasa, el `apply` falla en los registros, la asociación queda en el estado y basta repetir el `apply`.
3. **Apex y `www`:** el apex lleva un alias A hacia el destino que da Amplify (`*.cloudfront.net`), con el zone id global de CloudFront `Z2FDTNDATAQYW2` y `evaluate_target_health = false` (un CNAME no se permite en el apex). `www` es CNAME con TTL 300. Sin AAAA (no se sabe si la distribución de Amplify admite IPv6, por confirmar). `allow_overwrite` en su valor por defecto (false): si ya existe un registro para el apex o `www`, el `apply` falla con "already exists" y no pisa nada. Si Amplify creara por su cuenta esos registros, el `apply` también chocaría (por confirmar); no se hace `import` sin confirmación expresa.
4. **Orden en el mismo `apply`:** los registros leen atributos de `aws_amplify_domain_association.this`, así que Terraform los crea después de la asociación (dependencia implícita). `wait_for_verification = false` sigue igual.
5. **`quality-check`:** `aws_route53_record` y los data sources no están en `TAGGABLE`; `Z2FDTNDATAQYW2` no es un número de 12 dígitos ni un ARN; sin `http://`; con `custom_domains = {}` (dev) todo `for_each` sale vacío.

### Paso 6: registros de Route53 para los dominios

- Archivo: `modules/amplify/main.tf`, tras `aws_amplify_domain_association.this` (paso 1), sin tocar `variables.tf`, `outputs.tf`, `environments/` ni `modules/dns`. Depende del paso 1.

```hcl
# The public hosted zone has the same name as the root domain and must live in this account
data "aws_route53_zone" "custom" {
  for_each = var.custom_domains

  name         = each.key
  private_zone = false
}

locals {
  # AWS-wide hosted zone id of CloudFront, required by alias records that point at a distribution
  cloudfront_hosted_zone_id = "Z2FDTNDATAQYW2"

  # Keys come only from var.custom_domains (known at plan time), never from resource attributes
  domain_records = {
    for item in flatten([
      for domain, prefixes in var.custom_domains : [
        for prefix in prefixes : {
          fqdn   = prefix == "" ? domain : "${prefix}.${domain}"
          domain = domain
          prefix = prefix
        }
      ]
    ]) : item.fqdn => item
  }

  # "<name> CNAME <value>" => [name, value]; fails at apply if Amplify returns another format
  certificate_records = {
    for domain in keys(var.custom_domains) : domain => [
      for part in split("CNAME", aws_amplify_domain_association.this[domain].certificate_verification_dns_record) :
      trimsuffix(trimspace(part), ".")
    ]
  }

  # "<prefix> CNAME <target>" (empty prefix for the apex) => target
  domain_targets = {
    for fqdn, item in local.domain_records : fqdn => trimsuffix(trimspace(split("CNAME", one([
      for sub in aws_amplify_domain_association.this[item.domain].sub_domain : sub.dns_record if sub.prefix == item.prefix
    ]))[1]), ".")
  }
}

# Certificate validation record; without it the domain never leaves PENDING_VERIFICATION
resource "aws_route53_record" "certificate_validation" {
  for_each = var.custom_domains

  zone_id = data.aws_route53_zone.custom[each.key].zone_id
  name    = local.certificate_records[each.key][0]
  type    = "CNAME"
  ttl     = 300
  records = [local.certificate_records[each.key][1]]
}

# Apex: alias to the CloudFront distribution (a CNAME is not allowed at the apex)
resource "aws_route53_record" "apex" {
  for_each = { for fqdn, item in local.domain_records : fqdn => item if item.prefix == "" }

  zone_id = data.aws_route53_zone.custom[each.value.domain].zone_id
  name    = each.key
  type    = "A"

  alias {
    name                   = local.domain_targets[each.key]
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# Subdomains (www): CNAME to the CloudFront distribution
resource "aws_route53_record" "subdomain" {
  for_each = { for fqdn, item in local.domain_records : fqdn => item if item.prefix != "" }

  zone_id = data.aws_route53_zone.custom[each.value.domain].zone_id
  name    = each.key
  type    = "CNAME"
  ttl     = 300
  records = [local.domain_targets[each.key]]
}
```

- Notas para el developer: si dos entradas dan el mismo `fqdn`, Terraform falla con "Duplicate object key" (correcto; no lo ocultes); `terraform fmt` puede reformatear los `for` multilínea (déjalo como lo deje `fmt`); `sub.prefix == item.prefix` asume que el apex llega con prefijo vacío en `sub_domain` (por confirmar; si el `plan` o el `apply` falla con "argument must not be null", es este punto); un `data` y un `locals` nuevos no rompen `docs-check`, que solo mira el par `resource "aws_amplify_app" "this" {` y `name =`: compruébalo igualmente.
- Comprobación: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `environments/prod` y `environments/dev`; `git diff` de `environments/dev/`, `environments/prod/` (salvo lo del paso 3) y `modules/dns/`: vacío; `Grep` en `modules/amplify` de `http://` y de 12 dígitos: cero; `node scripts/quality-check.mjs`. `validate` no ejecuta las expresiones con valores desconocidos: la comprobación real es el `plan` del humano.
- Norma: BP-1, BP-2, BP-10; SEG-1, SEG-8; `para-frontend.md` sección 2 "Dominios".

### A cargo del tester-documentador (añadidos de la Fase 2)

1. `docs/referencia-modulos.md`, módulo amplify: recursos nuevos (dominio, validación del certificado, apex alias A, `www` CNAME) y que consulta la zona pública del dominio raíz; sin variable ni output nuevos; `modules/dns` no cambia.
2. `docs/integracion/para-frontend.md`, dominios y "Orden de despliegue": los registros los crea Terraform; el apex es un alias, no un CNAME; el `apply` falla si ya existen registros previos de apex o `www`.
3. `docs/estado-y-deuda-tecnica.md`: C9 con los registros incluidos; cerrar el hallazgo 2 de este plan, dejando el efecto en AWS como (por confirmar) hasta el `apply`; riesgo: repetir el `apply` si Amplify devuelve vacíos los campos DNS.
4. `README.md`: la fila nueva de dominio indica que los registros salen del módulo de Amplify; la celda `DNS` no se toca.
5. `docs/guias/seguridad.md`: en la fila de TLS, validación del certificado por DNS (CNAME) y apex como alias.

### Qué mira el humano en el `plan` (sustituye los puntos 2 y 3 y añade el 5)

2. **prod:** lo mismo en la app, más **cuatro** recursos nuevos: `aws_amplify_domain_association.this["sigmetum-a.org"]`; `aws_route53_record.certificate_validation["sigmetum-a.org"]`; `aws_route53_record.apex["sigmetum-a.org"]` (tipo A con alias); `aws_route53_record.subdomain["www.sigmetum-a.org"]` (CNAME). En los registros, `name` y `records` salen como "known after apply" (esperado). Nada en `module.dns`, `module.beanstalk` ni `module.storage`.
3. Si el `plan` falla con "no matching Route53Zone", la zona no está en la cuenta o no se llama como el dominio: parar antes del `apply`.
5. En el `apply` de prod: un error "already exists" en un registro significa un registro previo (o que Amplify lo creó solo): no usar `import` ni `allow_overwrite` sin decidirlo; un error de índice o de formato en el parseo significa que Amplify aún no había rellenado el campo: repetir el `apply` (la asociación ya está en el estado); después, comprobar en Route53 los tres registros y en la consola de Amplify que el certificado pasa de pendiente a emitido y que el dominio queda activo (puede tardar).

### Orden de despliegue (cambios)

- **Paso 2:** además de confirmar la zona y que no haya registros previos de apex ni `www`, comprobar que la zona está en la misma cuenta y perfil con el que se hace el `apply` de prod (el `plan` lo comprobará al leer la zona).
- **Paso 3:** los registros se crean en el mismo `apply` de prod; si falla por campos vacíos, repetirlo.
- **Paso 4:** esperar la validación del certificado, que ahora depende de que el CNAME de validación esté creado; con `wait_for_verification = false` el `apply` no avisa si la validación no cierra.

### Criterios que la spec refleja

- Decisión 1 y criterio de código 2: `modules/dns` sigue sin cambiar; los registros están en `modules/amplify` y se crean solo con `custom_domains` no vacío.
- Criterio nuevo de código: los registros no usan `allow_overwrite`, no hay AAAA, y `Z2FDTNDATAQYW2` es un identificador global de AWS que no es un secreto ni una cuenta.
- Criterio de documentación 1: `docs/referencia-modulos.md` incluye los recursos nuevos de `modules/amplify`, sin variables ni outputs nuevos.
- Por confirmar: formato real de `certificate_verification_dns_record` y `dns_record`; que `prefix` sea `""` en el apex; si Amplify crea registros solo; si hace falta AAAA; si los campos DNS llegan rellenos en el primer `apply`.

## Hallazgos fuera de la spec (sin añadir al alcance)

1. **`master` sigue siendo Create React App** (`para-infra.md` del frontend, sección 2): incompatible con el `build_spec` (Node 22, `npm test`, `dist`). El primer build de prod fallaría y el dominio podría quedarse pendiente de despliegue (por confirmar). Hay que fusionar `feature/testing` en `master` antes del `apply` de prod.
2. **Registros DNS del dominio:** si Amplify no crea solos los registros del certificado y de los subdominios en Route53, el dominio se quedará sin validar. Con el proveedor 5.x habría que crearlos desde `certificate_verification_dns_record` y `dns_record` (por confirmar si hace falta); eso exigiría tocar `modules/dns`, que la spec dice que no cambia: decisión del usuario, no implementada. Con `wait_for_verification = false` el `apply` no avisa de que falta.
3. **CSP:** el `onload` inline de las dos fuentes de `index.html` generará violaciones desde el primer día; `style-src 'unsafe-inline'` (styled-components) solo se podrá endurecer con informes; sin endpoint de informes (spec), las violaciones solo se ven en la consola.
4. **`ALLOWED_ORIGIN` y el dominio por defecto:** con los dos orígenes de la spec, el frontend servido desde el dominio de Amplify por defecto seguirá cargando, pero el backend le dará 403 por CORS.
5. **`customHttp.yml`:** el frontend no tiene ninguno hoy (verificado); si aparece uno en el repositorio anularía estas cabeceras (por confirmar). HSTS también se enviará desde `*.amplifyapp.com`, con el mismo `max-age` de un día.

## Cierre

- Documentos de `integracion` afectados: `docs/integracion/para-frontend.md` y `docs/integracion/para-backend.md`.
- Segunda opinión: se pide sobre este plan y sobre el diff.
