# Integración con el frontend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-frontend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios).

- Lo verificado contra el código de Terraform está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/09/2026. Infraestructura: rama `feature/testing` (cambios sin confirmar). Frontend: rama `feature/sigmetum_front_v2`, documento `docs/integracion/para-infra.md`.
- Los secretos de `terraform.tfvars` no se han leído; solo se comprobaron los nombres de las claves.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| **infra:C1** (= `frontend:I1`) | Amplify define `VITE_API_URL`; el frontend lee `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL` | La web compilada llama a `localhost` | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C2** (= `frontend:I2`) | El bucket bloquea el acceso público y no hay CloudFront | Los recursos de `assets/…` dan 403 | Abierto |
| **infra:C3** (= `frontend:I3`) | Sin regla de reescritura de la SPA en Amplify | Recargar `/explorar` da 404 | **Resuelto** (rama `feature/testing` de infra) |
| **infra:C4** (= `frontend:I4`) | `backend_url` de `dev` es `http://` | El navegador bloquea las peticiones (contenido mixto) | **Baja — aplazado hasta tener dominio dev** |
| **infra:C7** (= `frontend:I7`) | Nada sube `assets/…` al bucket | Faltan logos y banner | Abierto |
| **infra:C8** | `branch_url` no sustituye `/` por `-` en el nombre de rama | El origen real de `dev` probablemente no es el que calcula el output | Abierto (por confirmar) |
| **infra:C9** (parte de `frontend:I4`) | Falta el dominio del frontend en prod (`modules/dns` solo crea `backend.<zona>`) | No hay `ALLOWED_ORIGIN` de prod para el backend | Abierto |
| **infra:C10** | El `build_spec` no fija Node 20 ni ejecuta `npm test` | Riesgo de compilar con otra versión o desplegar una build rota | Abierto |
| **infra:C11** | Sin cabeceras de caché ni CSP en Amplify | Sección 6 de `para-infra.md` del frontend | Abierto |

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
preBuild: npm ci
build:    npm run build
artifacts: dist/**/*
cache:    node_modules/**/*
```

**(verificado en `modules/amplify/main.tf`).** No fija la versión de Node ni ejecuta tests (infra:C10): si el frontend necesita Node 20 en `preBuild` (por ejemplo `nvm use 20`) o que `npm test` corra antes de desplegar, avisa en una PR y se añade al `build_spec`.

### Variables de entorno que Amplify define hoy

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_BASE_URL` | App y rama | `backend_url` del entorno |
| `VITE_API_PREFIX` | App y rama | `/api/v1` (fijo) |
| `VITE_S3_URL` | App y rama | `s3_url` del entorno (vacío hasta resolver infra:C2) |
| `VITE_CAROUSEL_IMAGE_KEYS` | App y rama | `carousel_image_keys` (vacío hasta resolver infra:C2) |
| `NODE_ENV` | App | `dev` o `prod` |

**(verificado en rama `feature/testing` de infra).** El nombre completo de cada variable, con "Obligatoria" y el valor por entorno, lo decide el frontend en su `.env.example`; aquí solo se listan las que Amplify define.

### Reglas de reescritura

`custom_rule` añadida **(verificado, rama `feature/testing` de infra)**:

```hcl
custom_rule {
  source = "/<*>"
  target = "/index.html"
  status = "200"
}
```

Resuelve infra:C3. La regla más específica que propone `para-infra.md` del frontend (sección 6) queda pendiente para cuando se añadan cabeceras de caché (infra:C11).

### Cabeceras

Sin `customHeaders` (infra:C11, verificado).

### Dominios

| Entorno | Dominio hoy |
|---|---|
| `dev` | El que da Amplify por defecto: `https://<rama>.<default_domain>`. El output `branch_url` no sustituye `/` de `feature/testing` por `-`, así que probablemente no coincide con la URL real (infra:C8, por confirmar) |
| `prod` | Sin dominio propio asociado a la rama `master` (infra:C9, verificado: no hay `aws_amplify_domain_association` en el código) |

### Recursos estáticos (`assets/…`)

El bucket bloquea el acceso público con sus cuatro opciones (`modules/storage/main.tf`, verificado) y no hay CloudFront. Nada sube los ficheros al bucket (infra:C7, verificado). Hasta que se resuelva (infra:C2), `VITE_S3_URL` no tiene un valor que sirva contenido.

### Certificado y TLS

En `prod`, el backend tiene un listener HTTPS con `ELBSecurityPolicy-TLS13-1-2-2021-06` si se pasa `ssl_certificate_arn` (verificado). Amplify gestiona su propio certificado para el dominio por defecto y para cualquier dominio propio asociado; no lo gestiona este repositorio.

## 3. Qué necesita la infraestructura del frontend

| Necesidad | Detalle | Fuente |
|---|---|---|
| Node compatible | Vite 6 y los tests del frontend; el `build_spec` no fija versión (infra:C10) | `para-infra.md` del frontend, sección 2 |
| Instalación con `npm ci` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| Compilación con `npm run build` a `dist/` | El `build_spec` ya lo hace | `modules/amplify/main.tf` |
| `npm test` en `preBuild` | No está hoy (infra:C10) | `para-infra.md` del frontend, sección 2 |
| Nombres de las variables `VITE_*` | `VITE_BASE_URL`, `VITE_API_PREFIX`, `VITE_S3_URL`, `VITE_CAROUSEL_IMAGE_KEYS` (contrastado con `../sigmetum-frontend/.env.example`; **avisa `docs-check`/`quality-check` si cambian**) | `.env.example` del frontend |
| Que ninguna variable `VITE_*` lleve un secreto | Vite las incrusta en el JavaScript compilado, son públicas | `para-infra.md` del frontend, sección 3 |

## 4. Orden de despliegue

1. **Antes de fusionar el frontend en `feature/testing` o `master`:** las variables `VITE_*` que necesita deben existir en `modules/amplify` (infra:C1) y, si usa un recurso nuevo de `assets/…`, debe ser accesible (infra:C2/C7).
2. **Antes de que infra cambie `backend_url`, el bucket o una variable `VITE_*`:** avisar al frontend, porque exige una compilación nueva (los valores están incrustados en el JavaScript).
3. **`ALLOWED_ORIGIN` depende de la URL de Amplify**, que se conoce tras crear la app: hay dos vueltas de `apply`, o se fija un dominio propio desde el principio (infra:C9).

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
