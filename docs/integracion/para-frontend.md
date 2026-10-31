# Integración con el frontend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-frontend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios).

- Lo verificado contra el código de Terraform está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/10/2026 (inicial 30/09/2026). Infraestructura: rama `feature/testing`, commit base `d3866f5` (cambios sin commitear). Frontend: rama `feature/sigmetum_front_v2` (commit `7019869`), documento `docs/integracion/para-infra.md`.
- Los secretos de `terraform.tfvars` no se han leído; solo se comprobaron los nombres de las claves.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| **infra:C1** (= `frontend:I1`) | Amplify define `VITE_API_URL`; el frontend lee `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL` | La web compilada llama a `localhost` | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C2** (= `frontend:I2`) | El bucket bloqueaba el acceso público y no había CloudFront | Los recursos de `assets/…` daban 403 | **Resuelto** (CloudFront con OAC en `dev` y `prod`; falta subir `assets/…`, infra:C7) |
| **infra:C3** (= `frontend:I3`) | Sin regla de reescritura de la SPA en Amplify | Recargar `/explorar` da 404 | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C4** (= `frontend:I4`) | `backend_url` de `dev` era `http://` | El navegador bloqueaba las peticiones (contenido mixto) | **Resuelto**: CloudFront (`enable_cdn`) delante de Beanstalk, `backend_url = module.beanstalk.backend_cdn_url` en `dev` |
| **infra:C7** (= `frontend:I7`) | Nada sube `assets/…` al bucket | Faltan logos y banner; con `VITE_S3_URL` de `prod` ya apuntando a CloudFront, `prod` da 403/404 en favicon y logos hasta resolverlo (riesgo aceptado; infra avisará) | Abierto |
| **infra:C8** | `branch_url` no sustituía `/` por `-` en el nombre de rama | El origen real de `dev` no era el que calculaba el output | **Resuelto**: `replace(var.branch, "/", "-")` **(verificado)** |
| **infra:C9** (parte de `frontend:I4`) | Falta el dominio del frontend en prod (`modules/dns` solo crea `backend.<zona>`) | No hay `ALLOWED_ORIGIN` de prod para el backend | Abierto |
| **infra:C10** | El `build_spec` no fijaba Node ni ejecutaba `npm test` | Riesgo de compilar con otra versión o desplegar una build rota | **Resuelto en código** (Node 22 con `nvm` y `npm test` en `preBuild`); efecto en Amplify **(por confirmar)** hasta el `apply` |
| **infra:C11** | Sin cabeceras de caché ni CSP en Amplify | Sección 6 de `para-infra.md` del frontend | Abierto |
| **infra:C14** (= `frontend:I3`, `backend:F16`) | En el Amplify de `dev`, `/explorar` responde `301` a `/explorar/` y luego `404` aunque las dos `custom_rule` estaban aplicadas | Recargar o abrir un enlace directo a una ruta de la SPA falla | **Resuelto en código** (`source` de la regla SPA en `</regex/>`); comportamiento en `dev` y `prod` **(por confirmar)** hasta el `apply`. Se reabre si `/explorar` sigue dando `301` o `404` |

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

**(verificado en `modules/amplify/main.tf`).** Fija Node 22 con `nvm` en `preBuild` y ejecuta `npm test` justo después de `npm ci` (infra:C10): **si los tests fallan, Amplify no despliega**. Intención: migrar a Node 24 más adelante; infra cambiará el `build_spec` y avisará. **(Por confirmar)**: que la imagen de Amplify traiga Node 22 (si no, `nvm install 22` añade tiempo y exige red en el build) y que `nvm use` persista entre los comandos de `preBuild`.

### Variables de entorno que Amplify define hoy

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_BASE_URL` | App y rama | `backend_url` del entorno |
| `VITE_API_PREFIX` | App y rama | `/api/v1` (fijo) |
| `VITE_S3_URL` | App y rama | `s3_url` del entorno: URL de CloudFront de `storage` (`module.storage.cdn_url`) en `dev` y `prod` |
| `VITE_CAROUSEL_IMAGE_KEYS` | App y rama | `carousel_image_keys` (por defecto vacío) |
| `NODE_ENV` | App | `dev` o `prod` |

**(verificado en rama `feature/testing` de infra).** El nombre completo de cada variable, con "Obligatoria" y el valor por entorno, lo decide el frontend en su `.env.example`; aquí solo se listan las que Amplify define.

### Reglas de reescritura

Dos `custom_rule` **(verificado en `modules/amplify/main.tf`)**, en este orden:

| Origen | Destino | Estado |
|---|---|---|
| `/assets/<*>` | `/assets/<*>` | `200` (los recursos con hash pasan tal cual) |
| `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|webp\|pdf)$)([^.]+$)/>` | `/index.html` | `200` (la SPA: rutas sin punto y rutas con punto cuya extensión no está en la lista) |

En la tabla, `\|` es solo el escape de la barra vertical de Markdown: el valor real de `source` usa `|` y termina en `/>` (en HCL, `\.` se escribe `\\.`). Las rutas con punto cuya extensión no está en la lista (css, gif, ico, jpg, js, png, txt, svg, woff, woff2, ttf, map, json, webp, pdf) también se reescriben a `index.html`: es un límite conocido, y afecta por ejemplo a `.avif`, `.mp4`, `.xml`, `.webmanifest` y a extensiones en mayúsculas. La lista se amplía solo si el frontend lo pide. Resuelven infra:C3 e infra:C14.

**Causa de infra:C14 (por confirmar).** La hipótesis es que el `source` anterior terminaba en `$>` y no en `/>`, y que sin la `/` final Amplify no lo trataba como expresión regular. No está confirmada, y el `301` a barra final podría ser un comportamiento propio de Amplify independiente de las reglas. Tras el `apply` hay que probar `/explorar`, `/explorar/` y una ruta anidada, para distinguir si el `301` desaparece o solo cambia de código; si sigue habiendo `301` o `404`, C14 se reabre. Las cabeceras de caché que propone `para-infra.md` del frontend (sección 6) quedan pendientes (infra:C11).

### Cabeceras

Sin `customHeaders` (infra:C11, verificado).

### Dominios

| Entorno | Dominio hoy |
|---|---|
| `dev` | El que da Amplify por defecto: `https://<rama>.<default_domain>`. El output `branch_url` sustituye `/` por `-` (`replace(var.branch, "/", "-")`): `feature/testing` da `https://feature-testing.<default_domain>` (infra:C8, verificado) |
| `prod` | Sin dominio propio asociado a la rama `master` (infra:C9, verificado: no hay `aws_amplify_domain_association` en el código) |

### Recursos estáticos (`assets/…`)

El bucket bloquea el acceso público con sus cuatro opciones y se sirve por CloudFront con OAC (`modules/storage/main.tf`, verificado); `VITE_S3_URL` es la URL de CloudFront en `dev` y `prod`. Nada sube aún los ficheros de `assets/…` al bucket (infra:C7, verificado), así que `prod` da 403/404 en favicon y logos hasta resolverlo (riesgo aceptado). Que CloudFront sirva solo `assets/*` no está garantizado (C13 en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md#abiertos), por confirmar).

### Certificado y TLS

En `prod`, el backend tiene un listener HTTPS con `ELBSecurityPolicy-TLS13-1-2-2021-06` si se pasa `ssl_certificate_arn` (verificado). Amplify gestiona su propio certificado para el dominio por defecto y para cualquier dominio propio asociado; no lo gestiona este repositorio.

## 3. Qué necesita la infraestructura del frontend

| Necesidad | Detalle | Fuente |
|---|---|---|
| Node compatible | Vite 6 y los tests del frontend; el `build_spec` fija Node 22 (infra:C10). **Node 22 es una decisión de infra**; el `para-infra.md` del frontend (sección 2) aún dice "Node 20 o superior" y `nvm use 20`, y debe actualizarlo el frontend a Node 22 | `para-infra.md` del frontend, sección 2 |
| Instalación con `npm ci` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| Compilación con `npm run build` a `dist/` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| `npm test` en `preBuild` | Ya está (infra:C10); debe pasar sin red ni secretos y terminar solo, sin modo watch (el script del frontend es `vitest run`, verificado); infra no ha podido comprobar que no necesite red **(por confirmar)** | `para-infra.md` del frontend, sección 2; `package.json` del frontend |
| Riesgo hasta resolver infra:C7 | `prod` da 403/404 en favicon y logos | Infra avisará al resolverlo |
| Nombres de las variables `VITE_*` | `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL`, `VITE_CAROUSEL_IMAGE_KEYS` (contrastado con `../sigmetum-frontend/.env.example`; **avisa `docs-check`/`quality-check` si cambian**) | `.env.example` del frontend |
| Que ninguna variable `VITE_*` lleve un secreto | Vite las incrusta en el JavaScript compilado, son públicas | `para-infra.md` del frontend, sección 3 |

### Tareas para el frontend

- El build usa **Node 22** (decisión de infra, no del frontend): el frontend debe actualizar su `docs/integracion/para-infra.md` (sección 2) a Node 22 y ajustar el resto de su documentación (hoy `para-infra.md` dice "Node 20 o superior" y propone `nvm use 20`) y fijar `engines`/versión mínima (hoy `package.json` del frontend no tiene `engines`, verificado).
- Preparar la migración a **Node 24**; infra cambiará el `build_spec` en ese momento y avisará.
- Comprobar antes de fusionar que `npm test` no necesita red ni secretos y que no queda en modo watch.

## 4. Orden de despliegue

1. **Antes de fusionar el frontend en `feature/testing` o `master`:** las variables `VITE_*` que necesita deben existir en `modules/amplify` (infra:C1) y, si usa un recurso nuevo de `assets/…`, debe ser accesible (infra:C2/C7).
2. **Antes de que infra cambie `backend_url`, el bucket o una variable `VITE_*`:** avisar al frontend, porque exige una compilación nueva (los valores están incrustados en el JavaScript).
3. **Cambio de este ajuste (30/10/2026):** el humano ejecuta `terraform apply` primero en `dev` (comprobar el build de Amplify con Node 22 y `nvm`) y después en `prod`; después, una compilación nueva del frontend (los valores `VITE_*` están incrustados).
4. **`ALLOWED_ORIGIN` depende de la URL de Amplify**, que se conoce tras crear la app: hay dos vueltas de `apply`, o se fija un dominio propio desde el principio (infra:C9).

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
| Dominios o certificado | Sección 2 | PR: dominio nuevo y cuándo estará activo |
| El bucket o su acceso | Sección 2 (recursos estáticos) | PR: si cambia `VITE_S3_URL` |
| `ALLOWED_ORIGIN` (ver [para-backend.md](para-backend.md)) | — | PR: origen nuevo por entorno |

## 7. Mantener este documento

- Se actualiza cuando cambian las variables `VITE_*` de `modules/amplify`, el `build_spec`, los dominios o el estado del bucket.
- Las discrepancias `infra:C*` se quitan de la sección 1 a medida que se resuelven; se verifican antes contra el código del frontend.
