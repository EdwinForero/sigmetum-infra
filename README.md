# sigmetum-infra

Terraform infrastructure for the Sigmetum platform. Manages Elastic Beanstalk (Node.js backend), Amplify (React frontend), S3 (app assets), networking, and DNS.

## Architecture

```
environments/
  dev/    — single EB instance (no ALB), Amplify on branch feature/testing
  prod/   — ALB + auto scaling, HTTPS, DNS via Route53

modules/
  networking/  — default VPC and subnets (data sources only)
  beanstalk/   — Elastic Beanstalk app + environment
  storage/     — S3 bucket + IAM policy for EB instance access
  amplify/     — Amplify app + branch + build spec
  dns/         — Route53 CNAME (prod only)
```

| Resource | Dev | Prod |
|---|---|---|
| Beanstalk app | `sigmetum-backend-dev` | `sigmetum-backend-prod` |
| Beanstalk env | `sigmetum-backend-dev-env` | `sigmetum-backend-prod-env` |
| S3 bucket | `sigmetum-app-dev` | `sigmetum-app-prod` |
| Amplify app | `sigmetum-frontend` | `sigmetum-frontend` |
| Amplify branch | `feature/testing` | `master` |
| Instance type | t3.nano | t3.nano (1–3) |
| Load balancer | None (single instance) | ALB |
| HTTPS | No | Yes (ACM) |
| DNS | — | `backend.sigmetum-a.org` |
| Region | eu-west-1 | eu-west-1 |

## Prerequisites

> If you don't have Terraform installed yet, start here: [docs/terraform-setup.md](docs/terraform-setup.md)
>
> If you don't have AWS CLI installed and configured yet, see: [docs/aws-cli-setup.md](docs/aws-cli-setup.md)
>
> For multi-account setup (preprod + prod isolated accounts), see: [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md)


### 1. Terraform state bucket + Beanstalk IAM roles

Both are created per account (preprod and prod). Full commands in [docs/aws-organizations-setup.md](docs/aws-organizations-setup.md).

### 3. GitHub Personal Access Token

Generate a token at GitHub → Settings → Developer settings → Personal access tokens (classic) with scope `repo`. Keep it for the tfvars below.

### 4. (Prod only) ACM certificate

Request a certificate for `*.sigmetum-a.org` or `backend.sigmetum-a.org` in ACM (eu-west-1). Copy the ARN for the prod tfvars.

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

Create `terraform.tfvars` (never commit this file):

```hcl
notification_email  = "your@email.com"
bucket_name         = "sigmetum-app-dev"
github_repository   = "https://github.com/EdwinForero/sigmetum-frontend"
github_access_token = "ghp_..."

app_env_vars = {
  PORT            = "8000"
  AWS_REGION      = "eu-west-1"
  AWS_BUCKET_NAME = "sigmetum-app-dev"
  JWT_SECRET      = "<random 64-char hex>"
  JWT_EXPIRATION  = "30d"
  EMAIL           = "your-gmail@gmail.com"
  EMAIL_PASSWORD  = "your-gmail-app-password"
}
```

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

Create `terraform.tfvars`:

```hcl
notification_email  = "your@email.com"
bucket_name         = "sigmetum-app-prod"
github_repository   = "https://github.com/EdwinForero/sigmetum-frontend"
github_access_token = "ghp_..."
ssl_certificate_arn = "arn:aws:acm:eu-west-1:..."

app_env_vars = {
  PORT            = "8000"
  AWS_REGION      = "eu-west-1"
  AWS_BUCKET_NAME = "sigmetum-app-prod"
  JWT_SECRET      = "<different random secret from dev>"
  JWT_EXPIRATION  = "30d"
  EMAIL           = "your-gmail@gmail.com"
  EMAIL_PASSWORD  = "your-gmail-app-password"
}
```

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
> `aws s3 rm s3://sigmetum-app-dev --recursive`

## Cost tracking

All resources are tagged with `Project`, `Environment`, `ManagedBy`, and `Component`. To see costs broken down by component in AWS Cost Explorer, activate the tags after the first deploy: [docs/billing-tags.md](docs/billing-tags.md)

## Secrets and sensitive values

- `terraform.tfvars` files are gitignored — never commit them.
- Rotate the GitHub access token periodically and update the tfvars.
- `JWT_SECRET` should differ between dev and prod.
- Use Gmail app passwords (not your account password) for `EMAIL_PASSWORD`.

## Outputs

After `terraform apply` both environments expose:

| Output | Description |
|---|---|
| `beanstalk_endpoint` | EB environment URL |
| `amplify_default_domain` | Amplify default domain |
| `amplify_branch_url` | Direct branch URL |
| `s3_bucket_name` | App S3 bucket name |
