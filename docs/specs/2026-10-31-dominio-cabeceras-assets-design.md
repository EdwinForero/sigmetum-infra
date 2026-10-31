# Dominio del frontend en prod, cabeceras de Amplify y subida de assets: spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

Cerrar tres hallazgos abiertos del frontend: C9 (en `prod` el frontend no tiene dominio propio), C11 (Amplify no envía cabeceras de caché ni de seguridad) y C7 (nada documenta ni automatiza la subida de `assets/…` al bucket). Tras el cambio, `prod` sirve el frontend en `sigmetum-a.org` y `www.sigmetum-a.org` por HTTPS, y esos dos orígenes son el valor de `ALLOWED_ORIGIN` de `prod`.

Estado actual contrastado con el código:
- `modules/dns` solo crea `backend.<zona>` (CNAME). `modules/amplify` solo declara app y rama; no hay `aws_amplify_domain_association`.
- `environments/prod/main.tf` fija la zona `sigmetum-a.org` y la rama `master` a mano; `environments/prod/variables.tf` no tiene variable de dominio.
- `ALLOWED_ORIGIN` ya admite una lista separada por comas (`para-backend.md`, sección 7).
- El repositorio del frontend no tiene hoy ninguna carpeta con los ficheros de `assets/…`: `public/` solo contiene `favicon.svg`, `manifest.json` y `robots.txt`; el resto de `assets/` es el `dist/assets/` generado por Vite (otra cosa distinta, con hash). Las claves están en `src/config/assets.js` (12 ficheros, sección 5 de `para-infra.md`).
- Dev ya tiene los 12 ficheros de `assets/` subidos a mano (verificado 31/10/2026). Prod: **(por confirmar)**.
- Los scripts existentes de `scripts/` (`quality-check.mjs`, `docs-check.mjs`) son `.mjs` ESM, sin dependencias, con comentario inicial en español (propósito, `Uso:`, límites) e importaciones `node:`.

## Decisiones registradas

Respuestas del usuario del 31/10/2026 que cierran las preguntas abiertas.

1. Dominio: la asociación de dominio vive en `modules/amplify`, con una variable de dominios. En `dev` la variable va vacía (no crea nada); en `prod` lleva los dos dominios. `modules/dns` no cambia.
2. Apex y `www`: ambos sirven la app y ambos entran en `ALLOWED_ORIGIN` de `prod` (HTTPS, separados por coma). No hay redirección de uno a otro.
   - **(por confirmar)**: que la zona `sigmetum-a.org` esté delegada en Route53 en la cuenta de `prod`, que esa cuenta sea la misma de Amplify y que no existan registros previos de apex o `www` que choquen. El usuario no lo ha confirmado y no hay perfil de `prod` en la máquina de trabajo.
3. C11: caché más cabeceras básicas más CSP en modo Report-Only, en `dev` y en `prod`. Detalle en "Cabeceras (C11)".
4. C7: script `.mjs` en `scripts/` de este repositorio, que llama a `aws s3 sync`. Detalle en el criterio de código 7 y en "Procedimiento de C7".
5. **Registros DNS en este ciclo (decisión del usuario en la puerta del plan, 31/10/2026; sustituye el «`modules/dns` no cambia» de la decisión 1 y del criterio de código 2 solo en lo necesario):** Amplify no crea los registros DNS al asociar el dominio por Terraform (según la segunda opinión, de memoria, **por confirmar**). Se crean con Terraform, solo si `custom_domains` no está vacío (dev no cambia): los registros de validación del certificado y los de cada subdominio a partir de `certificate_verification_dns_record` y `dns_record` de `aws_amplify_domain_association`, y el apex como registro alias, no CNAME (**por confirmar** el alias y el parseo). Dónde viven y cómo recibe la zona (variable o salida de `modules/dns`) lo decide el architect sin leer `terraform.tfvars`.

## Cabeceras (C11)

Qué debe devolver el frontend, en `dev` y en `prod`:

| Ruta | Cabecera | Valor |
|---|---|---|
| `index.html` | `Cache-Control` | `no-cache` |
| `/assets/*` | `Cache-Control` | `public, max-age=31536000, immutable` |
| todas | `Strict-Transport-Security` | `max-age=86400` (ver HSTS) |
| todas | `X-Content-Type-Options` | `nosniff` |
| todas | `Referrer-Policy` | valor conservador **(por confirmar)** con el frontend: no filtrar rutas completas a terceros |
| todas | `Permissions-Policy` | desactivar las funciones que la app no usa; lista exacta **(por confirmar)** con el frontend |
| todas | `Content-Security-Policy-Report-Only` | ver CSP |

### HSTS: riesgos y valor fijado

- `max-age`: el navegador recuerda "solo HTTPS" durante ese tiempo y no hay vuelta atrás rápida si HTTPS falla (certificado caducado o dominio sin validar). Un valor largo amplifica ese riesgo.
- `includeSubDomains`: obliga a HTTPS en todos los subdominios, incluidos los que hoy no se controlen o no tengan certificado.
- `preload`: mete el dominio en la lista de los navegadores; retirarlo tarda meses. Irreversible en la práctica.
- Valor fijado: `max-age=86400` (1 día), sin `includeSubDomains` y sin `preload`. Motivo: el dominio de `prod` es nuevo, la validación del certificado de Amplify aún no está comprobada y, si algo falla, el efecto caduca en un día. `preload` queda descartado. Subir `max-age` (y valorar `includeSubDomains`) es una decisión posterior, una vez comprobado el dominio en `prod` **(por confirmar)** cuándo.
- En `dev` (dominio de Amplify, no propio) el mismo valor: los dos entornos no divergen sin motivo.

### CSP en Report-Only

- Report-Only **no bloquea nada**: el navegador solo anota las violaciones. Sirve para descubrir qué rompería una CSP real antes de activarla.
- No hay endpoint de informes ni `report-uri`/`report-to` real, y no se inventa uno. Las violaciones solo se verán en la consola del navegador de quien abra la web. Utilidad en ese modo: limitada (hay que mirar a mano, página por página). **(por confirmar)** si el usuario la considera suficiente como fase previa o si prefiere un destino de informes más adelante.
- Orígenes que la política debe contemplar:
  - propio (`'self'`) y, en `dev`, el dominio de Amplify de la app; en `prod`, apex y `www`;
  - `fonts.googleapis.com` (hojas de estilo) y `fonts.gstatic.com` (ficheros de fuente);
  - el origen de `VITE_S3_URL` (assets del bucket);
  - el origen de `VITE_BASE_URL` (API del backend, para `connect-src`);
  - las URL prefirmadas de S3 de la región (`*.s3.<región>.amazonaws.com`), para las descargas o imágenes que lleven firma.
- Las directivas concretas, qué recurso va en cuál y si hacen falta `'unsafe-inline'` o nonces para lo que genera Vite **(por confirmar)** con el frontend: lo decide `architect`, no esta spec.

## Criterios de aceptación

### De código

1. C9: `sigmetum-a.org` y `www.sigmetum-a.org` quedan asociados a la rama `master` de la app de Amplify de `prod`, mediante el recurso de dominio de `modules/amplify` alimentado por la variable de dominios. Se comprueba leyendo el `.tf` y con `terraform validate` en `environments/prod`. El efecto real en AWS **(por confirmar)** hasta el `apply` humano.
2. C9: con la variable de dominios vacía (`dev`) no se crea ningún recurso de dominio; `modules/dns` no cambia.
3. C9: el dominio no introduce ninguna URL con `http://`, secretos ni ARN en `.tf` ni en `*.example`. Los nombres de dominio de la zona pública no son secretos.
4. C9: `environments/prod/terraform.tfvars.example` solo cambia, si procede, el comentario de formato de `ALLOWED_ORIGIN` (lista de dos orígenes `https://` separados por coma, con marcadores). `app_env_vars` no se toca. `terraform.tfvars` no se lee ni se edita.
5. C11: la app de Amplify devuelve en `dev` y `prod` las cabeceras de la tabla de "Cabeceras (C11)". Se comprueba en el `.tf` y, tras el despliegue, con `curl -I` a `/index.html` y a un fichero de `/assets/*` **(por confirmar)**. El patrón de `/assets/*` no debe afectar a los ficheros del bucket, que se sirven desde otro origen. La CSP viaja solo como `Content-Security-Policy-Report-Only`; no existe `Content-Security-Policy` bloqueante.
6. C11: la regla de reescritura de la SPA y el build_spec no cambian de comportamiento (la regla `/assets/<*>` sigue pasando los ficheros con hash).
7. C7: existe un script `.mjs` en `scripts/` que ejecuta `aws s3 sync` desde una carpeta de origen a `s3://<bucket>/assets/`.
   - Estilo como los demás scripts de `scripts/`: ESM, sin dependencias, comentario inicial en español con `Uso:`.
   - La carpeta de origen es un parámetro obligatorio, sin valor por defecto.
   - Bucket y perfil de AWS son parámetros, sin valores reales por defecto y sin identificadores de cuenta en el script ni en los documentos.
   - Modo simulación con `--dryrun`.
   - Nunca usa `--delete`.
   - No obliga al frontend a crear ninguna carpeta ni a cambiar nada.
   - Se comprueba ejecutándolo en simulación contra `dev`; la ejecución real la hace el humano **(por confirmar)**.
8. C7: sin recursos de Terraform nuevos y sin comandos de AWS que cambien recursos ejecutados por ningún rol.
9. Si el script nuevo exige entrada en `quality-check`, `docs-check` o `docsPorArea` de `.claude/flujo.json`, se anota como criterio de documentación (ver abajo). El área `scripts/**` ya pide `docs/guias/mantenimiento.md`.
10. `terraform fmt -check -recursive`, `terraform validate` (dev y prod), `node scripts/quality-check.mjs`, `node scripts/docs-check.mjs` y `node plugins/ciclo-agentico/scripts/docs-gate.mjs` pasan; si se tocan `plugins/`, también `node --test "plugins/**/tests/**/*.test.mjs"`.

### De documentación

1. `docs/referencia-modulos.md`: variable de dominios, outputs y recursos nuevos (dominio, cabeceras) en `modules/amplify`; es el único sitio de variables, outputs y claves de `app_env_vars`.
2. `docs/integracion/para-frontend.md`: C9 y C11 pasan a resueltos en código (efecto en AWS **(por confirmar)** hasta el `apply`); secciones de dominios, cabeceras y orden de despliegue puestas al día; procedimiento de C7.
3. `docs/integracion/para-backend.md`: fila `prod` de `ALLOWED_ORIGIN` con el formato (dos orígenes `https://`, solo marcadores), y la dependencia de orden.
4. `docs/estado-y-deuda-tecnica.md`: C7, C9 y C11 actualizados, con "Última actualización: DD/MM/AAAA" de hoy y las cifras que cambien.
5. `README.md` (fila DNS y entornos), `docs/guias/mantenimiento.md` (por el script nuevo en `scripts/`) y `docs/guias/seguridad.md` (filas de TLS, HSTS y CSP, con el estado real: CSP solo en Report-Only).
6. Si el script nuevo requiere entrada en `quality-check`, `docs-check` o `docsPorArea`, se documenta en `mantenimiento.md` y se registra en el resumen final.
7. Orden de despliegue y qué debe hacer cada repositorio (ver abajo), en el resumen final y en el aviso de PR (`.github/pull_request_template.md`, sección "Frontend y backend").

## Procedimiento de C7

- El frontend no tiene una carpeta con los 12 ficheros de `assets/…`; el procedimiento documentado debe explicar de dónde sacarlos (fuente de verdad **(por confirmar)** con el usuario: `dev` los tiene subidos a mano y es el único sitio verificado donde existen).
- Debe cubrir: obtener los 12 ficheros en una carpeta local, ejecutar primero la simulación (`--dryrun`), revisar la salida y ejecutar la subida real (acción humana).
- Las claves esperadas están en `src/config/assets.js` del frontend (sección 5 de `para-infra.md`); la lista se contrasta contra ellas.

## Fuera de alcance

- backend:I7 y `TRUST_PROXY_HOPS` (ciclo A2 aparte).
- S3 y M5 (estado remoto).
- Cambios en el código del backend o del frontend (incluido mover o crear la carpeta de assets en el frontend).
- `terraform apply`, `plan` y cualquier comando de AWS que cambie recursos: los hace el humano, ningún rol.
- Cambiar `VITE_BASE_URL`, `VITE_S3_URL` o `app_env_vars` de `dev`.
- Activar una CSP bloqueante y crear un destino de informes de CSP.
- `includeSubDomains` y `preload` de HSTS.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta.
  - Dominios: el frontend de `prod` pasa a servirse desde `https://sigmetum-a.org` y `https://www.sigmetum-a.org`. El frontend no necesita cambios de código (`VITE_BASE_URL` sigue siendo el backend).
  - Cabeceras: `index.html` y `/assets/*` cambian de caché; se añaden HSTS, `nosniff`, Referrer-Policy, Permissions-Policy y la CSP en Report-Only. El frontend debe revisar la consola del navegador por si la CSP en Report-Only avisa de orígenes que usa y no están contemplados.
  - Assets (C7): el frontend no tiene que crear nada; el procedimiento no depende de una ruta en su repositorio.
- `docs/integracion/para-backend.md`: lo afecta. `ALLOWED_ORIGIN` de `prod` debe contener los dos orígenes con HTTPS (formato `https://<apex>,https://www.<apex>`, sin barra final). Es un cambio en `terraform.tfvars` de `prod` que hace el humano.
- Orden de despliegue propuesto:
  1. Humano: añadir los dos orígenes a `ALLOWED_ORIGIN` en `terraform.tfvars` de `prod` y aplicar el backend (el backend debe aceptarlos antes de que el frontend sirva desde el dominio).
  2. Confirmar que la zona `sigmetum-a.org` de Route53 está delegada en el registrador, que está en la cuenta de `prod` (la de Amplify) y que no hay registros previos para el apex ni `www` que choquen **(por confirmar)**.
  3. `apply` de `prod` con el dominio; el certificado de Amplify debe validarse (validación DNS) y el dominio quedar activo **(por confirmar)**; puede tardar y requiere esperar.
  4. Subir los assets al bucket de `prod` con el script (primero `--dryrun`) y comprobar `VITE_S3_URL` (C7).
  5. Comprobar la sección 8 de `para-infra.md` con el nuevo dominio y revisar la consola del navegador por avisos de la CSP.
- Frontend: sin cambios de código. Backend: sin cambios de código; solo el valor de `ALLOWED_ORIGIN` en `prod`.

## Preguntas abiertas

Ninguna.
