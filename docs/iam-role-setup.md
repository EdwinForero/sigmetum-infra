# Configuración del rol IAM — rol de despliegue de Terraform

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

> **Nota sobre `modules/backend-ci-iam`:** el módulo tiene una variable obligatoria nueva, `access_logs_bucket_name` (nombre del bucket de logs de acceso del entorno; los entornos le pasan `module.storage.access_logs_bucket_name`). Sirve para activar los registros de acceso del bucket de staging de Beanstalk con `aws_s3_bucket_logging`. No cambian los permisos del rol de CI; quien haga el `apply` necesita `s3:PutBucketLogging` sobre ese bucket.

---

## Antes de empezar: comprueba la región

> **Cada vez que abras la consola de AWS, comprueba que la región de la esquina superior derecha es `eu-west-3` (París) antes de hacer nada.**

---

## 1. Crear el rol

1. Abre **IAM** → **Roles** → **Create role**
2. **Trusted entity type:** AWS account
3. Introduce el ID de la cuenta que asumirá el rol (cuenta de gestión o de CI)
4. Pulsa **Next**

---

## 2. Asignar permisos

- Busca `AdministratorAccess` → márcalo → **Next**

---

## 3. Nombrar y crear

- **Nombre del rol:** `sigmetum-terraform-role`
- **Descripción:** rol de despliegue de Terraform para la infraestructura de Sigmetum
- **Tags:**
  - `Project` = `sigmetum`
  - `ManagedBy` = `manual`
- **Create role**

---

## 4. Conectarlo en Terraform

Añade `assume_role` a `providers.tf`:

```hcl
provider "aws" {
  region = "eu-west-3"

  assume_role {
    role_arn = "arn:aws:iam::<ACCOUNT_ID>:role/sigmetum-terraform-role"
  }
  ...
}
```
