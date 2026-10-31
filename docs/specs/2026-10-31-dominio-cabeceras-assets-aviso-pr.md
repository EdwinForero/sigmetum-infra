# Aviso para PR: dominio de prod, cabeceras de Amplify y subida de assets

Fecha: 31/10/2026 · Cambio **crítico** (red y TLS; contrato con el frontend y el backend) · Spec: [design](2026-10-31-dominio-cabeceras-assets-design.md) · Plan: [plan](2026-10-31-dominio-cabeceras-assets-plan.md)

## Qué cambia

- `modules/amplify`: variable nueva `custom_domains` (`map(list(string))`, por defecto `{}`); `aws_amplify_domain_association.this` por dominio raíz (`wait_for_verification = false`); `custom_headers` en la app; `data.aws_route53_zone.custom` y los registros `certificate_validation` (CNAME), `apex` (alias A) y `subdomain` (CNAME de `www`). Sin outputs nuevos. `build_spec`, `custom_rule`, `environment_variables` y `aws_amplify_branch` no cambian.
- `environments/prod/main.tf`: `custom_domains` con el dominio raíz de la zona, apex y `www`. `environments/dev` no cambia (sin dominio ni registros). `modules/dns` no cambia.
- `environments/prod/terraform.tfvars.example`: solo el comentario de formato de `ALLOWED_ORIGIN`; valores y `app_env_vars` intactos.
- `scripts/sync-assets.mjs` y `scripts/sync-assets.test.mjs`: subida de `assets/` al bucket con `aws s3 sync` (`--dryrun`; nunca `--delete`).
- Hallazgos: `infra:C9` y `infra:C11` resueltos en código; `infra:C7` con procedimiento disponible, pendiente de la subida a prod. Efecto en AWS **(por confirmar)** hasta el `apply`.
- Cabeceras (`dev` y `prod`): HSTS de un día sin `includeSubDomains` ni `preload`; `nosniff`; `Referrer-Policy`; `Permissions-Policy`; `Content-Security-Policy-Report-Only` (no bloquea nada); `Cache-Control` `no-cache` en `/index.html` e inmutable en `/assets/*` (el de Vite, no el del bucket).

## Frontend: qué debe hacer

1. Fusionar `feature/testing` en `master` **antes del `apply` de prod**: `master` sigue siendo Create React App (`react-scripts`), incompatible con el `build_spec` (Node 22, `npm test`, `dist`).
2. Corregir el `onload="this.rel='stylesheet'"` de los dos `<link rel="preload">` de fuentes de `index.html`: generará violaciones de CSP desde el primer día. Revisar la consola del navegador por avisos de `Content-Security-Policy-Report-Only` y avisar de orígenes no contemplados, antes de que infra endurezca la política.
3. Sin cambios de código obligatorios: `VITE_BASE_URL` sigue siendo el backend. No hay que crear carpeta de assets. Si añade un `customHttp.yml`, anularía las cabeceras (hoy no existe).
4. Fuente de verdad de los 12 ficheros de `assets/` para prod: por confirmar con el usuario (hoy solo se ha verificado `dev`).

## Backend: qué debe hacer

1. Poner en `ALLOWED_ORIGIN` de prod los dos orígenes: `https://<dominio>,https://www.<dominio>` (marcadores; sin barra final; comparación exacta, sensible a mayúsculas) y **desplegar antes** del `apply` de infra en prod.
2. Sin cambios de código: `app.js` ya acepta una lista separada por comas. El dominio por defecto de Amplify de prod no estará en la lista y recibirá 403 por CORS.

## Orden de despliegue (lo ejecuta una persona; ningún rol hace `apply`)

1. Backend con los dos orígenes en `ALLOWED_ORIGIN` de prod.
2. Confirmar la zona pública del dominio en Route53 de la cuenta de prod, delegada en el registrador, y sin registros previos de apex ni `www` **(por confirmar)**.
3. Frontend: `master` ya fusionado con `feature/testing`.
4. `apply` en `dev`: el `plan` solo debe cambiar `custom_headers` de la app; relanzar el build de la rama y `curl -I` a `/`, `/index.html`, `/explorar` y un fichero de `/assets/*`.
5. `apply` en `prod`. El `plan` debe mostrar, además del cambio de la app, cuatro nuevos: la asociación de dominio, el CNAME de validación, el alias A del apex y el CNAME de `www` (en los registros, `name` y `records` salen "known after apply"). Nada en `module.dns`, `module.beanstalk` ni `module.storage`. Cualquier `destroy` o `replace` es motivo de parar.
6. Esperar el certificado y que el dominio quede activo (consola de Amplify o `aws amplify get-domain-association`, solo lectura); relanzar el build de `master` si hace falta.
7. Subir los assets de prod: `node scripts/sync-assets.mjs --source <carpeta> --bucket <bucket-de-prod> --profile <perfil-de-prod> --dryrun`, revisar y repetir sin `--dryrun`. Comprobar la sección 8 de `para-infra.md` del frontend.

## Por confirmar

- Zona en la cuenta de prod, delegación y ausencia de registros previos de apex o `www`. Un error "already exists" en el `apply` significa un registro previo (o que Amplify lo creó solo): no usar `import` ni `allow_overwrite` sin decidirlo.
- Formato real de `certificate_verification_dns_record` y `dns_record`, prefijo vacío en el apex, necesidad de AAAA, y si Amplify devuelve vacíos los campos DNS en el primer `apply` (entonces repetir el `apply`; la asociación ya está en el estado).
- Que las cabeceras se apliquen solo en el siguiente build; que `/explorar` salga con `no-cache` y `/assets/*` cubra ficheros anidados (si no, ampliar el patrón).
- `img-src` con el formato virtual-hosted de las URL prefirmadas; `'unsafe-inline'` en `style-src`.
- Con `wait_for_verification = false`, el `apply` no avisa si la validación del certificado no cierra.
- `execFile` de `aws` en Windows con `aws.exe` y no con `.cmd`.

Integración: `docs/integracion/para-frontend.md` y `docs/integracion/para-backend.md` actualizados (crítico).
