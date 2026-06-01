# IAM Role Setup — Terraform Deploy Role

> **Este doc ya no aplica al setup actual.**
>
> El proyecto usa **AWS IAM Identity Center (SSO)** para autenticar Terraform directamente en cada cuenta con el rol `AWSReservedSSO_AdministratorAccess`. No se necesita un rol manual `sigmetum-terraform-role`.
>
> Ver [aws-cli-setup.md](aws-cli-setup.md) para el setup correcto.

---

## Cuándo sí aplica

Este enfoque (rol manual + `assume_role`) es útil si en el futuro quieres correr Terraform desde **CI/CD** (GitHub Actions, etc.) sin SSO interactivo. En ese caso:

1. Crea el rol en la cuenta destino (preprod o prod)
2. Dale permisos con `AdministratorAccess` (o una policy más restrictiva)
3. Configura el trust policy para que lo pueda asumir el runner de CI
4. Añade `assume_role` al `providers.tf` del ambiente correspondiente

---

## Before you start — set the correct region

> **Every time you open the AWS Console, verify the region in the top-right corner is set to `eu-west-1` (Ireland) before doing anything.**

---

## 1. Create the role

1. Open **IAM** → **Roles** → **Create role**
2. **Trusted entity type:** AWS account
3. Enter the account ID that will assume the role (management or CI account)
4. Click **Next**

---

## 2. Attach permissions

- Search for `AdministratorAccess` → check it → **Next**

---

## 3. Name and create

- **Role name:** `sigmetum-terraform-role`
- **Description:** Terraform deploy role for Sigmetum infrastructure
- **Tags:**
  - `Project` = `sigmetum`
  - `ManagedBy` = `manual`
- **Create role**

---

## 4. Wire it up in Terraform

Add `assume_role` to `providers.tf`:

```hcl
provider "aws" {
  region = "eu-west-1"

  assume_role {
    role_arn = "arn:aws:iam::<ACCOUNT_ID>:role/sigmetum-terraform-role"
  }
  ...
}
```
