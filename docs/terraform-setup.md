# Terraform Setup (Windows)

---

## 1. Instalar Terraform

### Opción A — winget (recomendado, no requiere nada extra)

```powershell
winget install HashiCorp.Terraform
```

Cierra y vuelve a abrir PowerShell. Verifica:

```powershell
terraform version
# Terraform v1.x.x
```

### Opción B — Chocolatey

Si ya tienes `choco`:

```powershell
choco install terraform -y
terraform version
```

### Opción C — Manual (sin gestor de paquetes)

1. Descarga el zip de la versión más reciente desde [releases.hashicorp.com/terraform](https://releases.hashicorp.com/terraform/)
   - Elige `terraform_X.X.X_windows_amd64.zip`
2. Extrae el archivo `terraform.exe` a una carpeta permanente, por ejemplo `C:\tools\terraform\`
3. Añade esa carpeta al PATH:
   ```powershell
   [System.Environment]::SetEnvironmentVariable(
     "Path",
     $env:Path + ";C:\tools\terraform",
     [System.EnvironmentVariableTarget]::User
   )
   ```
4. Cierra y vuelve a abrir PowerShell. Verifica:
   ```powershell
   terraform version
   ```

---

## 2. Primer uso en este repo

Antes de correr Terraform necesitas tener el perfil AWS activo. Si aún no lo tienes, sigue [aws-cli-setup.md](aws-cli-setup.md) primero.

### Preprod (environments/dev)

**PowerShell:**
```powershell
aws sso login --sso-session sigmetum

cd environments/dev
$env:AWS_PROFILE = "sigmetum-preprod"

terraform init
terraform plan
terraform apply
```

**CMD:**
```cmd
aws sso login --sso-session sigmetum

cd environments/dev
set AWS_PROFILE=sigmetum-preprod

terraform init
terraform plan
terraform apply
```

### Prod (environments/prod)

**PowerShell:**
```powershell
cd environments/prod
$env:AWS_PROFILE = "sigmetum-prod"

terraform init
terraform plan
terraform apply
```

**CMD:**
```cmd
cd environments/prod
set AWS_PROFILE=sigmetum-prod

terraform init
terraform plan
terraform apply
```

---

## 3. Comandos del día a día

| Comando | Qué hace |
|---|---|
| `terraform init` | Descarga providers y configura el backend de estado |
| `terraform plan` | Muestra los cambios que se aplicarían, sin tocar nada |
| `terraform apply` | Aplica los cambios (pide confirmación) |
| `terraform destroy` | Destruye todos los recursos del entorno |
| `terraform output` | Muestra los outputs tras un apply |
| `terraform fmt` | Formatea los archivos `.tf` |
| `terraform validate` | Valida la sintaxis sin conectar a AWS |

> Siempre corre `plan` antes de `apply` para revisar qué va a cambiar.

---

## Siguiente paso

Con Terraform instalado y el perfil AWS activo, sigue con el [primer deploy del README](../README.md#first-time-deploy).
