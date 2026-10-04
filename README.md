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
| CI artifacts bucket | `sigmetum-backend-deploys-dev` | `sigmetum-backend-deploys-prod` |
| Region | eu-west-3 | eu-west-3 |

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

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in (never commit this file). The variables and the `app_env_vars` keys are described in [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-dev).

```powershell
terraform init
terraform plan
terraform apply
```

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

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in (never commit this file). The variables and the `app_env_vars` keys are described in [docs/referencia-modulos.md](docs/referencia-modulos.md#entorno-prod).

```powershell
terraform init
terraform plan
terraform apply
```

## Day-to-day operations

### Deploy backend

Beanstalk deploys automatically when you push a new application bundle. Upload a zip of the backend source via the AWS Console or CI/CD.

### Deploy frontend

Amplify auto-builds on every push to the configured branch (`feature/testing` for preprod, `master` for prod).

### Destroy an environment

```bash
cd environments/dev   # or prod
terraform destroy
```

> The S3 bucket for app assets will fail to destroy if it contains objects. Empty it first:
> `aws s3 rm s3://sigmetum-app-assets-dev --recursive`

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
| [scripts/quality-check.mjs](scripts/quality-check.mjs) | Quality and security gate: `node scripts/quality-check.mjs` (run it together with `node scripts/docs-check.mjs`) |
| [docs/estado-y-deuda-tecnica.md](docs/estado-y-deuda-tecnica.md) | Metrics, open findings and technical debt |
| [docs/terraform-setup.md](docs/terraform-setup.md) | Install Terraform and first use |
| [docs/aws-cli-setup.md](docs/aws-cli-setup.md) | AWS CLI and SSO profiles |
| [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md) | Multi-account setup and state buckets |
| [docs/iam-role-setup.md](docs/iam-role-setup.md) | Terraform deploy role |
| [docs/billing-tags.md](docs/billing-tags.md) | Cost tags |
| [docs/integracion/para-frontend.md](docs/integracion/para-frontend.md) | What this infrastructure provides to and needs from the frontend (Amplify, `VITE_*`, domains, static assets) |
| [docs/integracion/para-backend.md](docs/integracion/para-backend.md) | What it provides to and needs from the backend (`app_env_vars`, health check, ALB, S3 IAM) |

## CI and GitHub

`.github/workflows/ci.yml` runs `terraform fmt -check -recursive`, `terraform validate` for each environment, `node scripts/quality-check.mjs` and `node scripts/docs-check.mjs` on every pull request (no AWS credentials, no `plan`, no `apply`). Branch protection and Dependabot security updates are GitHub settings described in [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios).
