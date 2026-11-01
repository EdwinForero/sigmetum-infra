# sigmetum-infra

Terraform infrastructure for the Sigmetum platform. Manages Elastic Beanstalk (Node.js backend), Amplify (React frontend), S3 (app assets), networking, and DNS.

## Architecture

```
environments/
  dev/    — single EB instance (no ALB), CloudFront como terminador HTTPS, Amplify en feature/testing
  prod/   — ALB + auto scaling, HTTPS con ACM, DNS via Route53

modules/
  networking/  — default VPC and subnets (data sources only)
  beanstalk/   — Elastic Beanstalk app + environment (+ CloudFront proxy en dev)
  storage/     — S3 bucket + CloudFront OAC + IAM policy for EB instance access
  amplify/         — Amplify app + branch + build spec
  dns/             — Route53 CNAME (prod only)
  backend-ci-iam/  — GitHub Actions OIDC role + S3 artifact bucket for Beanstalk CI deploys
```

| Resource | Dev | Prod |
|---|---|---|
| Beanstalk app | `sigmetum-backend-dev` | `sigmetum-backend-prod` |
| Beanstalk env | `sigmetum-backend-dev-env` | `sigmetum-backend-prod-env` |
| S3 bucket | `sigmetum-app-assets-dev` | `sigmetum-app-assets-prod` |
| Amplify app | `sigmetum-frontend-dev` | `sigmetum-frontend-prod` |
| Amplify branch | `feature/testing` | `master` |
| Instance type | t3.nano | t3.nano (1–3) |
| Load balancer | None (single instance) | ALB |
| HTTPS | No (CloudFront proxy para dev, sin ACM) | Yes (ACM en ALB) |
| DNS | — | `backend.sigmetum-a.org` |
| Frontend domain | — (Amplify default domain) | `sigmetum-a.org` and `www.sigmetum-a.org` (association and Route53 records created by the Amplify module, not by `modules/dns`) |
| Access logs bucket | `sigmetum-access-logs-dev` | `sigmetum-access-logs-prod` |
| CI artifacts bucket | `sigmetum-backend-deploys-dev` | `sigmetum-backend-deploys-prod` |
| HTTP to HTTPS redirect (80 to 443) | — | Yes (listener rule, 301; only with ALB and certificate) |
| Origin access (port 80) | Own security group, CloudFront prefix list only (in code; pending `apply`, S17) | Security group of the ALB, managed by Beanstalk (unchanged) |
| Region | eu-west-3 | eu-west-3 |

Dev and prod differ on purpose in how the backend origin is protected: dev has no ALB, so the module creates a security group that only admits HTTP from CloudFront (and a direct call to the Beanstalk CNAME stops working); prod sits behind an ALB whose security group Beanstalk manages, so nothing is added there (whether the ALB needs this change is to be confirmed). See [S17](docs/estado-y-deuda-tecnica.md#abiertos) and [docs/referencia-modulos.md](docs/referencia-modulos.md#restricción-del-origen-a-cloudfront-solo-dev).

Each environment has its own S3 access logs bucket (`sigmetum-access-logs-<env>`, created in `modules/storage`) that receives the access logs of the data bucket (`app-data/` prefix) and of the Beanstalk staging bucket (`beanstalk-staging/` prefix, only its logging setting is managed by Terraform). Logs expire after ninety days; the bucket has `prevent_destroy` and does not log itself ([M15](docs/estado-y-deuda-tecnica.md#abiertos)). Dev and prod have the same structure; only the name changes, so there is no divergence.

Diagramas: [dev](docs/diagramas/arquitectura-dev.html) · [prod](docs/diagramas/arquitectura-prod.html)

## Prerequisites

> If you don't have Terraform installed yet, start here: [docs/terraform-setup.md](docs/terraform-setup.md)
>
> If you don't have AWS CLI installed and configured yet, see: [docs/aws-cli-setup.md](docs/aws-cli-setup.md)
>
> For multi-account setup (preprod + prod isolated accounts), see: [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md)


### 1. Terraform state bucket + Beanstalk IAM roles

Both are created per account (preprod and prod). Full commands in [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md).

### 2. GitHub Personal Access Token

Generate a token at GitHub → Settings → Developer settings → Personal access tokens (classic) with scope `repo`. Keep it for the tfvars below.

### 3. (Prod only) ACM certificate

Request a certificate for `*.sigmetum-a.org` or `backend.sigmetum-a.org` in ACM (eu-west-3). Copy the ARN for the prod tfvars.

## First-time deploy

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

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in (never commit this file). The variables and the `app_env_vars` keys are described in [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-dev). `terraform plan` fails with "Invalid value for variable" if `app_env_vars` lacks any of the nine keys the backend requires at startup (names only are checked, never values). `TRUST_PROXY_HOPS` is an optional `app_env_vars` key: its dev value (two) was measured at nginx and deduced for Express, and applying it reconfigures the Beanstalk environment and may restart the app.

```powershell
terraform init
terraform plan
terraform apply
```

Note: this requires Terraform >= 1.11. The backend uses native S3 locking (`use_lockfile`) and encryption, and the provider lock file is versioned per environment. If you already initialised this environment, run `terraform init -reconfigure` (stop if it asks to migrate state); see [Remote state](docs/guias/mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo) in the maintenance guide.

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

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in (never commit this file). The variables and the `app_env_vars` keys are described in [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-prod). `terraform plan` fails with "Invalid value for variable" if `app_env_vars` lacks any of the nine keys the backend requires at startup (names only are checked, never values). `TRUST_PROXY_HOPS` is an optional `app_env_vars` key and its prod value is to be confirmed: measure it with the procedure in [docs/integracion/para-backend.md](docs/integracion/para-backend.md#medir-los-saltos-de-proxy-trust_proxy_hops) before the first prod `apply`.

```powershell
terraform init
terraform plan
terraform apply
```

Note: this requires Terraform >= 1.11. The backend uses native S3 locking (`use_lockfile`) and encryption, and the provider lock file is versioned per environment. If you already initialised this environment, run `terraform init -reconfigure` (stop if it asks to migrate state); see [Remote state](docs/guias/mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo) in the maintenance guide.

## Day-to-day operations

### Deploy backend

Beanstalk deploys automatically when you push a new application bundle. Upload a zip of the backend source via the AWS Console or CI/CD.

### Deploy frontend

Amplify auto-builds on every push to the configured branch (`feature/testing` for preprod, `master` for prod). The build pins Node 22 with `nvm` and runs `npm test` in `preBuild`: if the tests fail, Amplify does not deploy.

Dev and prod differ on purpose in two Amplify settings: `custom_domains` is empty in dev (no domain association and no Route53 records; the app is served from the Amplify default domain) and set in prod (apex and `www`, same app, no redirect between them). Both environments send the same cache and security headers (HSTS of one day, CSP in report-only mode). Prod deploy order and checks: [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md#4-orden-de-despliegue).

### Destroy an environment

```bash
cd environments/dev   # or prod
terraform destroy
```

> **The app assets bucket has `prevent_destroy = true` in both environments, so `terraform destroy` fails on purpose** (it also fails if the bucket contains objects). To destroy an environment, do it manually and deliberately:
>
> 1. Empty the bucket, including every object version and delete marker (`aws s3 rm s3://<bucket> --recursive` only adds delete markers on a versioned bucket; delete the versions and markers too, e.g. with `aws s3api delete-objects`).
> 2. Remove `prevent_destroy` from `aws_s3_bucket.app` in `modules/storage/main.tf` through a reviewed change.
> 3. Only then run `terraform destroy`, with explicit confirmation.
>
> The bucket also has a lifecycle rule (non-current versions expire after 180 days, incomplete multipart uploads after 7 days). The HTTP to HTTPS redirect (port 80 to 443, 301) exists only in prod (ALB with certificate); dev has no ALB.

## Cost tracking

All resources are tagged with `Project`, `Environment`, `ManagedBy`, and `Component`. To see costs broken down by component in AWS Cost Explorer, activate the tags after the first deploy: [docs/billing-tags.md](docs/billing-tags.md)

## Secrets and sensitive values

- `terraform.tfvars` files are gitignored — never commit them.
- Rotate the GitHub access token periodically and update the tfvars.
- `JWT_SECRET` should differ between dev and prod.
- Use Gmail app passwords (not your account password) for `EMAIL_PASSWORD`.

## Outputs

Each environment exposes its own outputs; they are listed in [docs/referencia-modulos.md](docs/referencia-modulos.md).

## Documentation

| Document | Content |
|---|---|
| [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md) | Rules to keep the documentation up to date and definition of done (read it after every change) |
| [docs/guias/buenas-practicas-terraform.md](docs/guias/buenas-practicas-terraform.md) | Terraform rules: structure, variables, versions, state, tags, change flow (read it before touching any `.tf`) |
| [docs/guias/seguridad.md](docs/guias/seguridad.md) | Infrastructure security rules and current status (read it before touching IAM, S3, secrets, network, TLS or Amplify) |
| [docs/referencia-modulos.md](docs/referencia-modulos.md) | Variables and outputs of each module and environment, and the `app_env_vars` keys |
| [Spec](docs/specs/2026-10-31-dominio-cabeceras-assets-design.md), [plan](docs/specs/2026-10-31-dominio-cabeceras-assets-plan.md) and [PR notice](docs/specs/2026-10-31-dominio-cabeceras-assets-aviso-pr.md) | Prod frontend domain, Amplify cache and security headers and assets upload script (31/10/2026): C9, C11 and C7 resolved in code |
| [scripts/sync-assets.mjs](scripts/sync-assets.mjs) | Uploads the contents of `assets/` to the environment bucket with `aws s3 sync` (`--dryrun` first; never deletes). Optional test: `node --test scripts/sync-assets.test.mjs` |
| [scripts/quality-check.mjs](scripts/quality-check.mjs) | Quality and security gate: `node scripts/quality-check.mjs` (run it together with `node scripts/docs-check.mjs`) |
| [docs/estado-y-deuda-tecnica.md](docs/estado-y-deuda-tecnica.md) | Metrics, open findings and technical debt |
| [docs/terraform-setup.md](docs/terraform-setup.md) | Install Terraform and first use |
| [docs/aws-cli-setup.md](docs/aws-cli-setup.md) | AWS CLI and SSO profiles |
| [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md) | Multi-account setup and state buckets |
| [docs/iam-role-setup.md](docs/iam-role-setup.md) | Terraform deploy role |
| [docs/billing-tags.md](docs/billing-tags.md) | Cost tags |
| [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md) | What this infrastructure provides to and needs from the frontend (Amplify, `VITE_*`, domains, static assets) |
| [docs/integracion/para-backend.md](docs/integracion/para-backend.md) | What it provides to and needs from the backend (`app_env_vars`, health check, ALB, S3 IAM) |
| [Spec](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-design.md), [plan](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-plan.md) and [PR notice](docs/specs/2026-10-30-ajustes-integracion-frontend-backend-aviso-pr.md) | Integration adjustments with frontend and backend (30/10/2026): `s3_url` in prod, Node 22 and `npm test` in the Amplify `build_spec` |
| [Spec](docs/specs/2026-10-30-fix-regla-spa-amplify-design.md), [plan](docs/specs/2026-10-30-fix-regla-spa-amplify-plan.md) and [PR notice](docs/specs/2026-10-30-fix-regla-spa-amplify-aviso-pr.md) | Amplify SPA rewrite rule fix (30/10/2026): `source` of the SPA rule in `</regex/>` format (C14) |
| [Spec](docs/specs/2026-10-30-seguridad-bucket-iam-tls-design.md), [plan](docs/specs/2026-10-30-seguridad-bucket-iam-tls-plan.md) and [PR notice](docs/specs/2026-10-30-seguridad-bucket-iam-tls-aviso-pr.md) | Bucket, instance IAM, TLS and ALB security (30/10/2026): CloudFront only on `assets/*`, IAM by prefix, TLS deny, `prevent_destroy`, lifecycle and prod 80 to 443 redirect (C13, S7, S8, M6; S5 partial) |
| [Spec](docs/specs/2026-10-31-limpieza-deuda-c-design.md), [plan](docs/specs/2026-10-31-limpieza-deuda-c-plan.md) and [PR notice](docs/specs/2026-10-31-limpieza-deuda-c-aviso-pr.md) | Debt cleanup (31/10/2026): unused variables removed, descriptions on all variables and outputs, `app_env_vars` key validation in the beanstalk module, account IDs replaced by markers in two guides (M1, M4, M2, M7, S1); no resource changes |
| [Spec](docs/specs/2026-10-31-trust-proxy-hops-design.md), [plan](docs/specs/2026-10-31-trust-proxy-hops-plan.md) and [PR notice](docs/specs/2026-10-31-trust-proxy-hops-aviso-pr.md) | `TRUST_PROXY_HOPS` and dev origin restriction (31/10/2026): optional `app_env_vars` key measured in dev (`backend:I7` still open, prod to be confirmed) and a dev-only security group that admits port 80 only from CloudFront (S17) |
| [Spec](docs/specs/2026-10-31-m2-node-env-react-design.md), [plan](docs/specs/2026-10-31-m2-node-env-react-plan.md) and [PR notice](docs/specs/2026-10-31-m2-node-env-react-aviso-pr.md) | M2 reopened: `NODE_ENV` removed from Amplify; React in production mode |
| [Spec](docs/specs/2026-10-31-observabilidad-acceso-design.md), [plan](docs/specs/2026-10-31-observabilidad-acceso-plan.md) and [PR notice](docs/specs/2026-10-31-observabilidad-acceso-aviso-pr.md) | S3 access logs (31/10/2026): per-environment access logs bucket, logging on the data bucket and the Beanstalk staging bucket, ninety-day retention (S5 and M11 resolved in code; M15 new) |
| [Spec](docs/specs/2026-10-31-estado-remoto-design.md), [plan](docs/specs/2026-10-31-estado-remoto-plan.md) and [PR notice](docs/specs/2026-10-31-estado-remoto-aviso-pr.md) | Remote state, versions and lock file (31/10/2026): `encrypt` and native S3 locking in both backends, Terraform >= 1.11, CI on 1.15.5, versioned lock files (S3 and M5 resolved in code; S4 partial) |

## CI and GitHub

`.github/workflows/ci.yml` runs `terraform fmt -check -recursive`, `terraform validate` for each environment, `node scripts/quality-check.mjs` and `node scripts/docs-check.mjs` on every pull request (no AWS credentials, no `plan`, no `apply`). Branch protection and Dependabot security updates are GitHub settings described in [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios).
