# Integración con el frontend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-frontend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios).

- Lo verificado contra el código de Terraform está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 31/10/2026 (inicial 30/09/2026). Infraestructura: rama `feature/testing`, commit base `9128987` (cambios sin commitear). Frontend: rama `feature/sigmetum_front_v2` (commit `07938c3`), documento `docs/integracion/para-infra.md`.
- Los secretos de `terraform.tfvars` no se han leído; solo se comprobaron los nombres de las claves.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| **infra:C1** (= `frontend:I1`) | Amplify define `VITE_API_URL`; el frontend lee `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL` | La web compilada llama a `localhost` | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C2** (= `frontend:I2`) | El bucket bloqueaba el acceso público y no había CloudFront | Los recursos de `assets/…` daban 403 | **Resuelto** (CloudFront con OAC en `dev` y `prod`; falta subir `assets/…`, infra:C7) |
| **infra:C3** (= `frontend:I3`) | Sin regla de reescritura de la SPA en Amplify | Recargar `/explorar` da 404 | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C4** (= `frontend:I4`) | `backend_url` de `dev` era `http://` | El navegador bloqueaba las peticiones (contenido mixto) | **Resuelto**: CloudFront (`enable_cdn`) delante de Beanstalk, `backend_url = module.beanstalk.backend_cdn_url` en `dev` |
| **infra:C7** (= `frontend:I7`) | Nada sube `assets/…` al bucket | Faltan logos y banner; con `VITE_S3_URL` de `prod` ya apuntando a CloudFront, `prod` da 403/404 en favicon y logos hasta resolverlo (riesgo aceptado; infra avisará) | **Procedimiento disponible** (`scripts/sync-assets.mjs`, ver sección 2 "Recursos estáticos"); `dev` ya tiene los 12 ficheros (verificado 31/10/2026); pendiente la subida a `prod`, que hace una persona |
| **infra:C8** | `branch_url` no sustituía `/` por `-` en el nombre de rama | El origen real de `dev` no era el que calculaba el output | **Resuelto**: `replace(var.branch, "/", "-")` **(verificado)** |
| **infra:C9** (parte de `frontend:I4`) | Falta el dominio del frontend en prod (`modules/dns` solo crea `backend.<zona>`) | No hay `ALLOWED_ORIGIN` de prod para el backend | **Resuelto en código** (31/10/2026): `custom_domains` de `prod` asocia `sigmetum-a.org` y `www.sigmetum-a.org` a `master`, con los registros de Route53 creados por Terraform. Efecto en AWS **(por confirmar)** hasta el `apply` en `prod` |
| **infra:C10** | El `build_spec` no fijaba Node ni ejecutaba `npm test` | Riesgo de compilar con otra versión o desplegar una build rota | **Resuelto en código** (Node 22 con `nvm` y `npm test` en `preBuild`); **verificado en `dev`** (build #7, 30/10/2026: Node 22, 134 tests en verde y build correcto); `prod` **(por confirmar)**, sin aplicar ni comprobar desde aquí |
| **infra:C11** | Sin cabeceras de caché ni CSP en Amplify | Sección 6 de `para-infra.md` del frontend | **Resuelto en código** (31/10/2026): caché, HSTS de un día, `nosniff`, Referrer-Policy, Permissions-Policy y CSP solo en Report-Only en `dev` y `prod`. Efecto en AWS **(por confirmar)** hasta el `apply` y un build nuevo. Tarea para el frontend: sección 3 |
| **infra:C14** (= `frontend:I3`, `backend:F16`) | En el Amplify de `dev`, `/explorar` responde `301` a `/explorar/` y luego `404` aunque las dos `custom_rule` estaban aplicadas | Recargar o abrir un enlace directo a una ruta de la SPA falla | **Resuelto en código** (`source` de la regla SPA en `</regex/>`); **verificado en `dev`** tras el `apply` (30/10/2026): `/explorar`, `/explorar/` y una ruta anidada dan `200` sin `301`; `prod` **(por confirmar)**, sin aplicar ni comprobar desde aquí. Se reabre si `/explorar` sigue dando `301` o `404` |

El detalle de cada uno está en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md#abiertos).

## 2. Qué provee la infraestructura

### App y ramas de Amplify

| Entorno | App | Rama | Rama de GitHub que despliega |
|---|---|---|---|
| `dev` (preproducción) | `sigmetum-frontend-dev` **(verificado)** | `feature/testing` | `feature/testing` |
| `prod` | `sigmetum-frontend-prod` **(verificado)** | `master` | `master` |

Amplify auto-despliega en cada push a esas ramas (`enable_auto_build = true`, `modules/amplify/main.tf`, verificado).

### `build_spec`

```yaml
preBuild:  nvm install 22 && nvm use 22, npm ci, npm test
build:     npm run build
artifacts: dist (**/*)
cache:     node_modules/**/*
```

**(verificado en `modules/amplify/main.tf`).** Fija Node 22 con `nvm` en `preBuild` y ejecuta `npm test` justo después de `npm ci` (infra:C10): **si los tests fallan, Amplify no despliega**. Intención: migrar a Node 24 más adelante; infra cambiará el `build_spec` y avisará. **Verificado en `dev` (build #7, 30/10/2026, log del paso BUILD):** `nvm install 22` descarga e instala Node v22 en el propio build (necesita red, y añade unos segundos), `nvm use` persiste entre los comandos de `preBuild`, y `npm test` corre `vitest run` (22 ficheros, 134 tests en verde, sin modo watch). **(Por confirmar)** en `prod`, sin aplicar ni comprobar desde aquí.

### Variables de entorno que Amplify define hoy

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_BASE_URL` | App y rama | `backend_url` del entorno |
| `VITE_API_PREFIX` | App y rama | `/api/v1` (fijo) |
| `VITE_S3_URL` | App y rama | `s3_url` del entorno: URL de CloudFront de `storage` (`module.storage.cdn_url`) en `dev` y `prod` |
| `VITE_CAROUSEL_IMAGE_KEYS` | App y rama | `carousel_image_keys` (por defecto vacío) |
| `NODE_ENV` | App | `dev` o `prod`. Valor no estándar que no afecta a la compilación en `dev` (M2 cerrado; el módulo no cambia); efecto en `prod` **(por confirmar)** |

**(verificado en rama `feature/testing` de infra).** El nombre completo de cada variable, con "Obligatoria" y el valor por entorno, lo decide el frontend en su `.env.example`; aquí solo se listan las que Amplify define.

### Reglas de reescritura

Dos `custom_rule` **(verificado en `modules/amplify/main.tf`)**, en este orden:

| Origen | Destino | Estado |
|---|---|---|
| `/assets/<*>` | `/assets/<*>` | `200` (los recursos con hash pasan tal cual) |
| `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|webp\|pdf)$)([^.]+$)/>` | `/index.html` | `200` (la SPA: rutas sin punto y rutas con punto cuya extensión no está en la lista) |

En la tabla, `\|` es solo el escape de la barra vertical de Markdown: el valor real de `source` usa `|` y termina en `/>` (en HCL, `\.` se escribe `\\.`). Las rutas con punto cuya extensión no está en la lista (css, gif, ico, jpg, js, png, txt, svg, woff, woff2, ttf, map, json, webp, pdf) también se reescriben a `index.html`: es un límite conocido, y afecta por ejemplo a `.avif`, `.mp4`, `.xml`, `.webmanifest` y a extensiones en mayúsculas. La lista se amplía solo si el frontend lo pide. Resuelven infra:C3 e infra:C14.

**Causa de infra:C14 (confirmada en `dev`).** El `source` anterior terminaba en `$>` y no en `/>`, y sin la `/` final Amplify no lo trataba como expresión regular: con el formato `</regex/>` el `301` a barra final desapareció en `dev` (30/10/2026). En `prod` sigue **(por confirmar)**. Tras el `apply` se probó `/explorar`, `/explorar/` y una ruta anidada, para distinguir si el `301` desaparece o solo cambia de código; si sigue habiendo `301` o `404`, C14 se reabre. Las cabeceras de caché que propone `para-infra.md` del frontend (sección 6) están definidas en código (infra:C11, ver "Cabeceras"); la regla `/assets/<*>` sigue pasando los ficheros con hash.

### Cabeceras

`custom_headers` de la app de Amplify, igual en `dev` y `prod` **(verificado en `modules/amplify/main.tf`)** (infra:C11). Efecto en AWS **(por confirmar)** hasta el `apply` y un build nuevo de la rama (probablemente las cabeceras solo se aplican en el siguiente despliegue, por confirmar).

| Ruta | Cabecera | Valor |
|---|---|---|
| todas (`**`) | `Strict-Transport-Security` | `max-age=86400` (un día; sin `includeSubDomains` ni `preload`) |
| todas | `X-Content-Type-Options` | `nosniff` |
| todas | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| todas | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| todas | `Content-Security-Policy-Report-Only` | calculada: ver más abajo |
| `/index.html` | `Cache-Control` | `no-cache` |
| `/assets/*` | `Cache-Control` | `public, max-age=31536000, immutable` |

- **`/assets/*` es el de Vite, no el del bucket.** El patrón afecta al `dist/assets/` con hash que genera `npm run build`; los ficheros del bucket (`assets/…` de la sección "Recursos estáticos") se sirven desde CloudFront, otro origen, y no reciben estas cabeceras. Si `/explorar` no sale con `no-cache` o `/assets/*` no cubre ficheros anidados, habrá que ampliar el patrón **(por confirmar)**.
- **HSTS de un día** a propósito: el dominio de `prod` es nuevo y la validación del certificado no está comprobada; si algo falla el efecto caduca en un día. Subir `max-age` y valorar `includeSubDomains` es una decisión posterior; `preload` queda descartado. HSTS también se envía desde `*.amplifyapp.com`, con el mismo `max-age`.
- **CSP solo en Report-Only**: el navegador anota las violaciones en su consola y no bloquea nada; no existe `Content-Security-Policy` bloqueante ni endpoint de informes. Directivas: `default-src 'self'`; `script-src 'self'` (sin `'unsafe-inline'`); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src 'self' https://fonts.gstatic.com`; `img-src 'self'` más `VITE_S3_URL` más `https://*.s3.<región>.amazonaws.com` (galería con URL prefirmada, por confirmar); `connect-src 'self'` más `VITE_BASE_URL`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. Se calcula con `s3_url`, `backend_url` y la región, así que cada entorno obtiene la suya. Sin `data:` ni `blob:` (sin evidencia en el código).
- **Violación esperada desde el primer día:** el `index.html` del frontend usa `onload="this.rel='stylesheet'"` en dos `<link rel="preload">` de Google Fonts (manejador inline, **verificado** en `../sigmetum-frontend/index.html`). La CSP en Report-Only lo registrará como violación. Es una tarea del frontend (sección 3) antes de endurecer la política.
- Si el frontend añade un `customHttp.yml` al repositorio, anularía estas cabeceras (por confirmar). Hoy no existe (verificado).

### Dominios

| Entorno | Dominio |
|---|---|
| `dev` | El que da Amplify por defecto: `https://<rama>.<default_domain>`. El output `branch_url` sustituye `/` por `-` (`replace(var.branch, "/", "-")`): `feature/testing` da `https://feature-testing.<default_domain>` (infra:C8, verificado). `custom_domains` vacío: no se crea asociación ni registros |
| `prod` | `https://sigmetum-a.org` y `https://www.sigmetum-a.org`, ambos asociados a la rama `master` y sirviendo la misma app, sin redirección de uno a otro (infra:C9, **verificado en código**: `custom_domains` en `environments/prod/main.tf`). Efecto en AWS **(por confirmar)** hasta el `apply` en `prod`. El dominio por defecto de Amplify sigue activo (`branch_url` no cambia), pero el backend de `prod` no lo aceptará por CORS (solo los dos dominios propios) |

Los registros de Route53 los crea Terraform en `modules/amplify` (no `modules/dns`) **(verificado en código)**: CNAME de validación del certificado, **alias A para el apex** (un CNAME no se permite en el apex) y CNAME para `www`. Sin AAAA. Requisitos **(por confirmar)**: la zona pública `sigmetum-a.org` debe estar en la cuenta de `prod`, la misma de Amplify, y delegada en el registrador; si ya existen registros de apex o `www`, el `apply` falla con "already exists" (no pisa nada ni hace `import`). Si Amplify devuelve vacíos los campos DNS en el primer `apply`, se repite el `apply`. El frontend no necesita cambios de código por esto (`VITE_BASE_URL` sigue siendo el backend).

### Recursos estáticos (`assets/…`)

El bucket bloquea el acceso público con sus cuatro opciones y se sirve por CloudFront con OAC (`modules/storage/main.tf`, verificado); `VITE_S3_URL` es la URL de CloudFront en `dev` y `prod`. Ningún recurso de Terraform sube los ficheros de `assets/…` al bucket (infra:C7, verificado): se suben con `scripts/sync-assets.mjs` (procedimiento abajo). `dev` ya los tiene (12 ficheros, subidos a mano, verificado el 31/10/2026); en `prod` el estado del bucket es **(por confirmar)** y, hasta subirlos, `prod` da 403/404 en favicon y logos (riesgo aceptado). **CloudFront sirve solo `assets/*`** (la política del bucket da `s3:GetObject` a la distribución únicamente sobre `assets/*`, `modules/storage/main.tf`, verificado en código; C13 resuelto en código en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md#resueltos); efecto aplicado **(por confirmar)** tras el `apply` en `dev`): todo recurso público del frontend debe vivir bajo `assets/`. Una clave de `gallery/`, `data/` o la raíz pedida por CloudFront no devolverá el objeto. El frontend debe comprobar que no pide por `VITE_S3_URL` nada fuera de `assets/` **(por confirmar)**.

#### Procedimiento de subida (infra:C7)

El frontend no tiene una carpeta con estos ficheros: `public/` solo contiene `favicon.svg`, `manifest.json` y `robots.txt` (verificado), y el `assets/` de `dist` es otra cosa (el de Vite, con hash). El frontend no tiene que crear nada.

1. **Obtener los ficheros.** Fuente de verdad **(por confirmar)** con el usuario; el único sitio verificado donde existen es el bucket de `dev` (`assets/`). Descárgalos a una carpeta local que reproduzca la estructura, sin la carpeta `assets/` como nivel extra (`logos/…`, `banners/…`, `about/…`, `documents/…`).
2. **Contrastar la lista** con `src/config/assets.js` del frontend (**verificado** el 31/10/2026, 12 ficheros bajo `assets/`):

   | Carpeta | Ficheros |
   |---|---|
   | `logos/` | `app-logo.jpg`, `UMA.jpg` |
   | `logos/other-universities/` | `UAL.jpg`, `UGR.jpg`, `UHU.jpg`, `UJA.jpg` |
   | `logos/collaborators/` | `EFYVE.jpg`, `GEOSPACE.jpg`, `MaFo.jpg` |
   | `banners/` | `home-banner.jpg` |
   | `about/` | `about-us.jpg` |
   | `documents/` | `glossary.pdf` |

3. **Simulación** (no escribe nada): `node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket-de-prod> --profile <perfil-de-prod> --dryrun`. La primera línea imprime el comando exacto de `aws s3 sync`; revisa que el destino sea `s3://<bucket>/assets/` y que la lista coincida con la tabla.
4. **Subida real: la hace una persona**, con el mismo comando sin `--dryrun` y con la sesión abierta (`aws sso login --profile <perfil>`). El script sube el **contenido** de la carpeta (no la carpeta que la contiene), nunca usa `--delete` y no tiene valores por defecto de carpeta, bucket ni perfil. Ningún rol del ciclo lo ejecuta contra AWS.
5. **Comprobar** que CloudFront devuelve `200` para una clave de la tabla (por ejemplo, `<VITE_S3_URL>/assets/logos/app-logo.jpg`) y la sección 8 de `para-infra.md` del frontend.

El script exige la AWS CLI v2; en Windows, `execFile` sin shell funciona con `aws.exe` y no con un `.cmd` **(por confirmar)**.

### Certificado y TLS

En `prod`, el backend tiene un listener HTTPS con `ELBSecurityPolicy-TLS13-1-2-2021-06` si se pasa `ssl_certificate_arn` (verificado). Amplify gestiona su propio certificado para el dominio por defecto y para cualquier dominio propio asociado, con validación DNS: el registro CNAME de validación lo crea Terraform en Route53 (ver "Dominios"). Con `wait_for_verification = false`, el `apply` no espera ni avisa si la validación no cierra: hay que comprobar en la consola de Amplify, o con `aws amplify get-domain-association` (solo lectura), que el certificado pasa de pendiente a emitido y que el dominio queda activo (puede tardar) **(por confirmar)**.

## 3. Qué necesita la infraestructura del frontend

| Necesidad | Detalle | Fuente |
|---|---|---|
| Node compatible | Vite 6 y los tests del frontend; el `build_spec` fija Node 22 (infra:C10). **Node 22 es una decisión de infra**; el `para-infra.md` del frontend (sección 2) aún dice "Node 20 o superior" y `nvm use 20`, y debe actualizarlo el frontend a Node 22 | `para-infra.md` del frontend, sección 2 |
| Instalación con `npm ci` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| Compilación con `npm run build` a `dist/` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| `npm test` en `preBuild` | Ya está (infra:C10); debe pasar sin red ni secretos y terminar solo, sin modo watch (el script del frontend es `vitest run`, verificado); infra no ha podido comprobar que no necesite red **(por confirmar)** | `para-infra.md` del frontend, sección 2; `package.json` del frontend |
| Riesgo hasta subir los assets a `prod` (infra:C7) | `prod` da 403/404 en favicon y logos | Procedimiento en la sección 2; infra avisará cuando se suban |
| Nombres de las variables `VITE_*` | `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL`, `VITE_CAROUSEL_IMAGE_KEYS` (contrastado con `../sigmetum-frontend/.env.example`; **avisa `docs-check`/`quality-check` si cambian**) | `.env.example` del frontend |
| Que ninguna variable `VITE_*` lleve un secreto | Vite las incrusta en el JavaScript compilado, son públicas | `para-infra.md` del frontend, sección 3 |

### Tareas para el frontend

- El build usa **Node 22** (decisión de infra, no del frontend): el frontend debe actualizar su `docs/integracion/para-infra.md` (sección 2) a Node 22 y ajustar el resto de su documentación (hoy `para-infra.md` dice "Node 20 o superior" y propone `nvm use 20`) y fijar `engines`/versión mínima (hoy `package.json` del frontend no tiene `engines`, verificado).
- Preparar la migración a **Node 24**; infra cambiará el `build_spec` en ese momento y avisará.
- Comprobar antes de fusionar que `npm test` no necesita red ni secretos y que no queda en modo watch.
- **CSP (infra:C11):** tras el despliegue, abrir la web (en `dev` y, cuando esté, en `prod`) con la consola del navegador y revisar los avisos de `Content-Security-Policy-Report-Only`. La CSP no bloquea nada todavía. Corregir el manejador inline `onload="this.rel='stylesheet'"` de los dos `<link rel="preload">` de fuentes de `index.html` (viola `script-src 'self'`) antes de que infra endurezca la política, y avisar de cualquier origen que use y no esté contemplado (sección 2 "Cabeceras"). `style-src 'unsafe-inline'` (styled-components) solo se podrá endurecer con informes.
- **`master` del frontend:** sigue siendo Create React App (`react-scripts` 5.0.1, **verificado** el 31/10/2026 en `package.json` de `master`), incompatible con el `build_spec`. Fusionar `feature/testing` en `master` **antes del `apply` de `prod`** (sección 4).

## 4. Orden de despliegue

1. **Antes de fusionar el frontend en `feature/testing` o `master`:** las variables `VITE_*` que necesita deben existir en `modules/amplify` (infra:C1) y, si usa un recurso nuevo de `assets/…`, debe ser accesible (infra:C2/C7).
2. **Antes de que infra cambie `backend_url`, el bucket o una variable `VITE_*`:** avisar al frontend, porque exige una compilación nueva (los valores están incrustados en el JavaScript).
3. **Cambio de este ajuste (30/10/2026):** el humano ejecuta `terraform apply` primero en `dev` (comprobar el build de Amplify con Node 22 y `nvm`) y después en `prod`; después, una compilación nueva del frontend (los valores `VITE_*` están incrustados).
4. **`ALLOWED_ORIGIN` en `dev` depende de la URL de Amplify**, que se conoce tras crear la app. En `prod` ya no: el dominio propio está fijado en código (infra:C9).
5. **Dominio de `prod`, cabeceras y assets (31/10/2026).** Orden, todo por una persona (ningún rol del ciclo hace `apply`):
   1. **Backend primero:** añadir a `ALLOWED_ORIGIN` en el `terraform.tfvars` de `prod` los dos orígenes, `https://<dominio>,https://www.<dominio>` (sin barra final; comparación exacta, ver [para-backend.md](para-backend.md#7-allowed_origin-por-entorno)), y aplicar el backend antes de que el frontend sirva desde el dominio.
   2. **Confirmar la zona** `sigmetum-a.org` en Route53, en la cuenta y con el perfil con que se aplica `prod`, delegada en el registrador, y sin registros previos de apex ni `www` **(por confirmar)**. El `plan` fallará con "no matching Route53Zone" si la zona no está en esa cuenta.
   3. **Fusionar `feature/testing` en `master`** del frontend antes del `apply` de `prod`: `master` sigue siendo Create React App, incompatible con el `build_spec` (Node 22, `npm test`, `dist`); sin eso, el primer build de `prod` fallaría y el dominio podría quedarse sin despliegue **(por confirmar)**.
   4. **`apply` en `dev`** y comprobar las cabeceras: relanzar el build de la rama y `curl -I` a `/`, `/index.html`, `/explorar` y un fichero de `/assets/*` (HSTS, `nosniff`, Referrer-Policy, Permissions-Policy, `Content-Security-Policy-Report-Only`, `Cache-Control` según la tabla de "Cabeceras", y ninguna `Content-Security-Policy` bloqueante). En el `plan` de `dev` solo debe cambiar `custom_headers` de la app, sin asociación de dominio ni registros.
   5. **`apply` en `prod`:** además de la app, crea la asociación de dominio y los tres registros. Si falla con "already exists" en un registro, hay un registro previo: parar (no `import` ni `allow_overwrite` sin decidirlo). Si falla por campos DNS vacíos o de formato, repetir el `apply`. Cualquier `destroy` o `replace` en el `plan` es motivo de parar.
   6. **Esperar el certificado** y que el dominio quede activo (consola de Amplify o `aws amplify get-domain-association`, solo lectura); relanzar el build de `master` si hace falta.
   7. **Subir los assets de `prod`** con `--dryrun` y luego sin él (procedimiento en la sección 2). Comprobar la sección 8 de `para-infra.md` con el dominio nuevo y la consola del navegador por avisos de CSP.

## 5. Discrepancias (propias de este documento)

| Id | Qué pasa | Dónde | Responsable | Qué hacer |
|---|---|---|---|---|
| **F1** | El `.env.example` del frontend no marca cuáles de sus variables son obligatorias en cada entorno de forma legible por `docs-check`/`quality-check` (se infiere por convención) | `../sigmetum-frontend/.env.example` | frontend | Ninguna acción necesaria si la convención se mantiene; si cambia, avisar |
| **F2** | El frontend no documenta un tamaño máximo esperado para los recursos de `assets/…`, y `modules/storage` no lo limita | `../sigmetum-frontend/src/config/assets.js` | frontend e infra | Acordar un límite si CloudFront (opción recomendada de infra:C2) necesita configurarlo |

## 6. Si cambias algo (en `sigmetum-infra`)

| Si cambias... | Actualiza en este documento | Avisa |
|---|---|---|
| Variables `VITE_*` de `modules/amplify` | Sección 2 | PR: qué variable, valor nuevo por entorno (solo nombres si es secreto) |
| El `build_spec` | Sección 2 | PR: qué cambia en `preBuild`/`build` |
| Dominios, certificado o cabeceras de Amplify | Sección 2 ("Cabeceras", "Dominios") y sección 4 | PR: dominio nuevo, cuándo estará activo y qué avisos de CSP revisar |
| El bucket o su acceso | Sección 2 (recursos estáticos) | PR: si cambia `VITE_S3_URL` |
| `ALLOWED_ORIGIN` (ver [para-backend.md](para-backend.md)) | — | PR: origen nuevo por entorno |

## 7. Mantener este documento

- Se actualiza cuando cambian las variables `VITE_*` de `modules/amplify`, el `build_spec`, los dominios o el estado del bucket.
- Las discrepancias `infra:C*` se quitan de la sección 1 a medida que se resuelven; se verifican antes contra el código del frontend.
