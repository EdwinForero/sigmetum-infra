# sigmetum-infra

Infraestructura de Terraform de la plataforma Sigmetum. Gestiona Elastic Beanstalk (backend en Node.js), Amplify (frontend en React), S3 (recursos de la aplicación), la red y el DNS.

## Arquitectura

```
environments/
  dev/    — una sola instancia de EB (sin ALB), CloudFront como terminador HTTPS, Amplify en feature/testing
  prod/   — ALB + auto scaling, HTTPS con ACM, DNS con Route53

modules/
  networking/  — VPC y subredes por defecto (solo data sources)
  beanstalk/   — app y entorno de Elastic Beanstalk (+ CloudFront como proxy en dev)
  storage/     — bucket de S3 + CloudFront OAC + política IAM de acceso para la instancia de EB
  amplify/         — app, rama y build spec de Amplify
  dns/             — CNAME de Route53 (solo prod)
  backend-ci-iam/  — rol OIDC de GitHub Actions + bucket de artefactos de S3 para los despliegues de CI de Beanstalk
```

| Recurso | Dev | Prod |
|---|---|---|
| App de Beanstalk | `sigmetum-backend-dev` | `sigmetum-backend-prod` |
| Entorno de Beanstalk | `sigmetum-backend-dev-env` | `sigmetum-backend-prod-env` |
| Bucket de S3 | `sigmetum-app-assets-dev` | `sigmetum-app-assets-prod` |
| App de Amplify | `sigmetum-frontend-dev` | `sigmetum-frontend-prod` |
| Rama de Amplify | `feature/testing` | `master` |
| Tipo de instancia | t3.nano | t3.nano (1–3) |
| Balanceador | Ninguno (instancia única) | ALB |
| HTTPS | No (proxy de CloudFront en dev, sin ACM) | Sí (ACM en el ALB) |
| DNS | — | `backend.sigmetum-a.org` |
| Dominio del frontend | — (dominio por defecto de Amplify) | `sigmetum-a.org` y `www.sigmetum-a.org` (la asociación y los registros de Route53 los crea el módulo de Amplify, no `modules/dns`) |
| Bucket de logs de acceso | `sigmetum-access-logs-dev` | `sigmetum-access-logs-prod` |
| Bucket de artefactos de CI | `sigmetum-backend-deploys-dev` | `sigmetum-backend-deploys-prod` |
| Redirección de HTTP a HTTPS (80 a 443) | — | Sí (regla del listener, 301; solo con ALB y certificado) |
| Acceso al origen (puerto 80) | Grupo de seguridad propio, solo con la lista de prefijos de CloudFront (en código; pendiente del `apply`, S17) | Grupo de seguridad del ALB, gestionado por Beanstalk (sin cambios) |
| Región | eu-west-3 | eu-west-3 |

Dev y prod difieren a propósito en cómo se protege el origen del backend: dev no tiene ALB, así que el módulo crea un grupo de seguridad que solo admite HTTP desde CloudFront (y una llamada directa al CNAME de Beanstalk deja de funcionar); prod está detrás de un ALB cuyo grupo de seguridad gestiona Beanstalk, así que ahí no se añade nada (si el ALB necesita este cambio está por confirmar). Ver [S17](docs/estado-y-deuda-tecnica.md#abiertos) y [docs/referencia-modulos.md](docs/referencia-modulos.md#restricción-del-origen-a-cloudfront-solo-dev).

Los secretos del backend (`JWT_SECRET`, `EMAIL_PASSWORD`, `ADMIN_PASSWORD`) llegan a Beanstalk desde Parameter Store (`SecureString`) en los dos entornos con el mismo mecanismo; solo difiere el nombre del parámetro (`/sigmetum/dev/backend/<CLAVE>` y `/sigmetum/prod/backend/<CLAVE>`), así que no hay divergencia. Los crea el humano a mano antes del `apply`: [procedimiento](docs/integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano) y [referencia](docs/referencia-modulos.md#secretos-en-parameter-store).

Cada entorno tiene su propio bucket de logs de acceso de S3 (`sigmetum-access-logs-<entorno>`, creado en `modules/storage`), que recibe los registros de acceso del bucket de datos (prefijo `app-data/`) y del bucket de staging de Beanstalk (prefijo `beanstalk-staging/`; Terraform solo gestiona su ajuste de logs). Los registros caducan a los noventa días; el bucket tiene `prevent_destroy` y no se registra a sí mismo ([M15](docs/estado-y-deuda-tecnica.md#abiertos)). Dev y prod tienen la misma estructura; solo cambia el nombre, así que no hay divergencia.

Diagramas: [dev](docs/diagramas/arquitectura-dev.html) · [prod](docs/diagramas/arquitectura-prod.html)

## Requisitos previos

> Si aún no tienes Terraform instalado, empieza aquí: [docs/terraform-setup.md](docs/terraform-setup.md)
>
> Si aún no tienes la AWS CLI instalada y configurada, mira: [docs/aws-cli-setup.md](docs/aws-cli-setup.md)
>
> Para la configuración de varias cuentas (preprod y prod aisladas), mira: [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md)


### 1. Bucket del estado de Terraform y roles IAM de Beanstalk

Ambos se crean en cada cuenta (preprod y prod). Los comandos completos están en [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md).

### 2. Token de acceso personal de GitHub

Genera un token en GitHub → Settings → Developer settings → Personal access tokens (classic) con el alcance `repo`. Guárdalo para los `tfvars` de más abajo.

### 3. (Solo prod) Certificado de ACM

Solicita en ACM (eu-west-3) un certificado para `*.sigmetum-a.org` o `backend.sigmetum-a.org`. Copia el ARN para el `tfvars` de prod.

## Primer despliegue

### Dev

**PowerShell:**
```powershell
cd environments/dev
$env:AWS_PROFILE = "sigmetum-preprod"
```

**CMD:**
```cmd
cd environments/dev
set AWS_PROFILE=sigmetum-preprod
```

Copia `terraform.tfvars.example` a `terraform.tfvars` y rellénalo (no subas nunca este archivo a git). Las variables y las claves de `app_env_vars` están descritas en [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-dev). `terraform plan` falla con «Invalid value for variable» si a `app_env_vars` le falta alguna de las seis claves no secretas que el backend exige al arrancar, o si define `JWT_SECRET`, `EMAIL_PASSWORD` o `ADMIN_PASSWORD`, que viven en Parameter Store y se crean antes del `apply` ([procedimiento](docs/integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano)); solo se comprueban los nombres, nunca los valores. `TRUST_PROXY_HOPS` es una clave opcional de `app_env_vars`: su valor en dev (dos) se midió en nginx y se dedujo para Express, y aplicarla reconfigura el entorno de Beanstalk y puede reiniciar la aplicación.

```powershell
terraform init
terraform plan
terraform apply
```

Nota: requiere Terraform >= 1.11. El backend usa el bloqueo nativo de S3 (`use_lockfile`) y cifrado, y el archivo de bloqueo del proveedor se versiona por entorno. Si ya inicializaste este entorno, ejecuta `terraform init -reconfigure` (para si pide migrar el estado); ver [Estado remoto](docs/guias/mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo) en la guía de mantenimiento.

### Prod

**PowerShell:**
```powershell
cd environments/prod
$env:AWS_PROFILE = "sigmetum-prod"
```

**CMD:**
```cmd
cd environments/prod
set AWS_PROFILE=sigmetum-prod
```

Copia `terraform.tfvars.example` a `terraform.tfvars` y rellénalo (no subas nunca este archivo a git). Las variables y las claves de `app_env_vars` están descritas en [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-prod). `terraform plan` falla con «Invalid value for variable» si a `app_env_vars` le falta alguna de las seis claves no secretas que el backend exige al arrancar, o si define `JWT_SECRET`, `EMAIL_PASSWORD` o `ADMIN_PASSWORD`, que viven en Parameter Store y se crean antes del `apply` ([procedimiento](docs/integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano)); solo se comprueban los nombres, nunca los valores. `TRUST_PROXY_HOPS` es una clave opcional de `app_env_vars` y su valor en prod está por confirmar: mídelo con el procedimiento de [docs/integracion/para-backend.md](docs/integracion/para-backend.md#medir-los-saltos-de-proxy-trust_proxy_hops) antes del primer `apply` de prod.

```powershell
terraform init
terraform plan
terraform apply
```

Nota: requiere Terraform >= 1.11. El backend usa el bloqueo nativo de S3 (`use_lockfile`) y cifrado, y el archivo de bloqueo del proveedor se versiona por entorno. Si ya inicializaste este entorno, ejecuta `terraform init -reconfigure` (para si pide migrar el estado); ver [Estado remoto](docs/guias/mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo) en la guía de mantenimiento.

## Operaciones del día a día

### Desplegar el backend

Beanstalk despliega automáticamente cuando subes un nuevo paquete de la aplicación. Sube un zip del código del backend desde la consola de AWS o desde CI/CD.

### Desplegar el frontend

Amplify compila automáticamente en cada push a la rama configurada (`feature/testing` en preprod, `master` en prod). La compilación fija Node 22 con `nvm` y ejecuta `npm test` en `preBuild`: si las pruebas fallan, Amplify no despliega.

Dev y prod difieren a propósito en dos ajustes de Amplify: `custom_domains` está vacío en dev (sin asociación de dominio ni registros de Route53; la app se sirve desde el dominio por defecto de Amplify) y definido en prod (apex y `www`, la misma app, sin redirección entre ellos). Los dos entornos envían las mismas cabeceras de caché y de seguridad (HSTS de un día, CSP en modo solo informe). Orden y comprobaciones del despliegue de prod: [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md#4-orden-de-despliegue).

### Destruir un entorno

```bash
cd environments/dev   # o prod
terraform destroy
```

> **El bucket de recursos de la aplicación tiene `prevent_destroy = true` en los dos entornos, así que `terraform destroy` falla a propósito** (también falla si el bucket contiene objetos). Para destruir un entorno, hazlo a mano y de forma deliberada:
>
> 1. Vacía el bucket, incluidas todas las versiones de objetos y los marcadores de borrado (`aws s3 rm s3://<bucket> --recursive` solo añade marcadores de borrado en un bucket versionado; borra también las versiones y los marcadores, por ejemplo con `aws s3api delete-objects`).
> 2. Quita `prevent_destroy` de `aws_s3_bucket.app` en `modules/storage/main.tf` con un cambio revisado.
> 3. Solo entonces ejecuta `terraform destroy`, con confirmación expresa.
>
> El bucket tiene además una regla de ciclo de vida (las versiones no actuales caducan a los 180 días y las subidas multipart incompletas a los 7 días). La redirección de HTTP a HTTPS (puerto 80 a 443, 301) existe solo en prod (ALB con certificado); dev no tiene ALB.

## Seguimiento de costes

Todos los recursos llevan las etiquetas `Project`, `Environment`, `ManagedBy` y `Component`. Para ver los costes desglosados por componente en AWS Cost Explorer, activa las etiquetas tras el primer despliegue: [docs/billing-tags.md](docs/billing-tags.md)

## Secretos y valores sensibles

- Los archivos `terraform.tfvars` están en `.gitignore`: no los subas nunca a git.
- Rota periódicamente el token de acceso de GitHub y actualiza los `tfvars`.
- `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` no van en `terraform.tfvars`: viven en Parameter Store ([procedimiento](docs/integracion/para-backend.md#secretos-en-parameter-store-procedimiento-humano)).
- `JWT_SECRET` debe ser distinto en dev y en prod.
- Usa contraseñas de aplicación de Gmail (no la contraseña de tu cuenta) para `EMAIL_PASSWORD`.

## Outputs

Cada entorno expone sus propios outputs; están listados en [docs/referencia-modulos.md](docs/referencia-modulos.md).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md) | Reglas para mantener la documentación al día y definición de terminado (léelo tras cada cambio) |
| [docs/guias/buenas-practicas-terraform.md](docs/guias/buenas-practicas-terraform.md) | Reglas de Terraform: estructura, variables, versiones, estado, etiquetas, flujo de cambio (léelo antes de tocar cualquier `.tf`) |
| [docs/guias/seguridad.md](docs/guias/seguridad.md) | Reglas de seguridad de la infraestructura y su estado actual (léelo antes de tocar IAM, S3, secretos, red, TLS o Amplify) |
| [docs/referencia-modulos.md](docs/referencia-modulos.md) | Variables y outputs de cada módulo y entorno, y las claves de `app_env_vars` |
| [Spec](docs/specs/2026-10-31-dominio-cabeceras-assets-design.md), [plan](docs/specs/2026-10-31-dominio-cabeceras-assets-plan.md) y [aviso de PR](docs/specs/2026-10-31-dominio-cabeceras-assets-aviso-pr.md) | Dominio del frontend de prod, cabeceras de caché y seguridad de Amplify y script de subida de assets (31/10/2026): C9, C11 y C7 resueltos en código |
| [scripts/sync-assets.mjs](scripts/sync-assets.mjs) | Sube el contenido de `assets/` al bucket del entorno con `aws s3 sync` (primero `--dryrun`; nunca borra). Prueba opcional: `node --test scripts/sync-assets.test.mjs` |
| [scripts/quality-check.mjs](scripts/quality-check.mjs) | Puerta de calidad y seguridad: `node scripts/quality-check.mjs` (ejecútalo junto con `node scripts/docs-check.mjs`) |
| [docs/estado-y-deuda-tecnica.md](docs/estado-y-deuda-tecnica.md) | Métricas, hallazgos abiertos y deuda técnica |
| [docs/terraform-setup.md](docs/terraform-setup.md) | Instalar Terraform y primer uso |
| [docs/aws-cli-setup.md](docs/aws-cli-setup.md) | AWS CLI y perfiles de SSO |
| [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md) | Configuración de varias cuentas y buckets de estado |
| [docs/iam-role-setup.md](docs/iam-role-setup.md) | Rol de despliegue de Terraform |
| [docs/billing-tags.md](docs/billing-tags.md) | Etiquetas de costes |
| [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md) | Qué ofrece esta infraestructura al frontend y qué necesita de él (Amplify, `VITE_*`, dominios, recursos estáticos) |
| [docs/integracion/para-backend.md](docs/integracion/para-backend.md) | Qué ofrece al backend y qué necesita de él (`app_env_vars`, health check, ALB, IAM de S3) |
| [Spec](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-design.md), [plan](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-plan.md) y [aviso de PR](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-aviso-pr.md) | Ajustes de integración con el frontend y el backend (30/10/2026): `s3_url` en prod, Node 22 y `npm test` en el `build_spec` de Amplify |
| [Spec](docs/specs/2026-10-30-fix-regla-spa-amplify-design.md), [plan](docs/specs/2026-10-30-fix-regla-spa-amplify-plan.md) y [aviso de PR](docs/specs/2026-10-30-fix-regla-spa-amplify-aviso-pr.md) | Corrección de la regla de reescritura SPA de Amplify (30/10/2026): `source` de la regla SPA en formato `</regex/>` (C14) |
| [Spec](docs/specs/2026-10-30-seguridad-bucket-iam-tls-design.md), [plan](docs/specs/2026-10-30-seguridad-bucket-iam-tls-plan.md) y [aviso de PR](docs/specs/2026-10-30-seguridad-bucket-iam-tls-aviso-pr.md) | Seguridad del bucket, IAM de instancias, TLS y ALB (30/10/2026): CloudFront solo en `assets/*`, IAM por prefijo, `Deny` de TLS, `prevent_destroy`, ciclo de vida y redirección de 80 a 443 en prod (C13, S7, S8, M6; S5 parcial) |
| [Spec](docs/specs/2026-10-31-limpieza-deuda-c-design.md), [plan](docs/specs/2026-10-31-limpieza-deuda-c-plan.md) y [aviso de PR](docs/specs/2026-10-31-limpieza-deuda-c-aviso-pr.md) | Limpieza de deuda (31/10/2026): variables sin uso fuera, descripciones en todas las variables y outputs, validación de claves de `app_env_vars` en el módulo de Beanstalk, identificadores de cuenta sustituidos por marcadores en dos guías (M1, M4, M2, M7, S1); sin cambios de recursos |
| [Spec](docs/specs/2026-10-31-trust-proxy-hops-design.md), [plan](docs/specs/2026-10-31-trust-proxy-hops-plan.md) y [aviso de PR](docs/specs/2026-10-31-trust-proxy-hops-aviso-pr.md) | `TRUST_PROXY_HOPS` y restricción del origen de dev (31/10/2026): clave opcional de `app_env_vars` medida en dev (`backend:I7` sigue abierto, prod por confirmar) y un grupo de seguridad solo de dev que admite el puerto 80 únicamente desde CloudFront (S17) |
| [Aviso de PR](docs/specs/2026-10-31-limpieza-deuda-d-aviso-pr.md) | Limpieza de deuda (31/10/2026): `moved` de la política del bucket de datos, descripción de `load_balancers`, `TRUST_PROXY_HOPS` en `quality-check`, README en español (M12, M13, B2); sin cambios de recursos |
| [Spec](docs/specs/2026-10-31-m2-node-env-react-design.md), [plan](docs/specs/2026-10-31-m2-node-env-react-plan.md) y [aviso de PR](docs/specs/2026-10-31-m2-node-env-react-aviso-pr.md) | M2 reabierto: `NODE_ENV` fuera de Amplify; React en modo producción |
| [Spec](docs/specs/2026-10-31-observabilidad-acceso-design.md), [plan](docs/specs/2026-10-31-observabilidad-acceso-plan.md) y [aviso de PR](docs/specs/2026-10-31-observabilidad-acceso-aviso-pr.md) | Registros de acceso de S3 (31/10/2026): bucket de logs de acceso por entorno, registros en el bucket de datos y en el de staging de Beanstalk, retención de noventa días (S5 y M11 resueltos en código; M15 nuevo) |
| [Spec](docs/specs/2026-10-31-secretos-beanstalk-design.md), [plan](docs/specs/2026-10-31-secretos-beanstalk-plan.md) y [aviso de PR](docs/specs/2026-10-31-secretos-beanstalk-aviso-pr.md) | Secretos de Beanstalk en Parameter Store (31/10/2026): `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` salen de `app_env_vars` y llegan como `SecureString`; política IAM de lectura acotada (S6 resuelto en código, S2 parcial) |
| [Spec](docs/specs/2026-10-31-estado-remoto-design.md), [plan](docs/specs/2026-10-31-estado-remoto-plan.md) y [aviso de PR](docs/specs/2026-10-31-estado-remoto-aviso-pr.md) | Estado remoto, versiones y archivo de bloqueo (31/10/2026): `encrypt` y bloqueo nativo de S3 en los dos backends, Terraform >= 1.11, CI en 1.15.5, archivos de bloqueo versionados (S3 y M5 resueltos en código; S4 parcial) |

## CI y GitHub

`.github/workflows/ci.yml` ejecuta en cada pull request `terraform fmt -check -recursive`, `terraform validate` para cada entorno, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` (sin credenciales de AWS, sin `plan`, sin `apply`). La protección de la rama y las actualizaciones de seguridad de Dependabot son ajustes de GitHub descritos en [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios).
