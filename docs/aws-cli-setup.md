# AWS CLI Setup

> **Región en la consola:** verifica siempre que esté en `eu-west-1` (Ireland) antes de hacer cualquier cosa en AWS Console.

---

## 1. Instalar AWS CLI

1. Descarga el instalador para Windows:
   [https://awscli.amazonaws.com/AWSCLIV2.msi](https://awscli.amazonaws.com/AWSCLIV2.msi)
2. Ejecuta el `.msi` y sigue el asistente
3. Cierra y vuelve a abrir PowerShell
4. Verifica la instalación:
   ```powershell
   aws --version
   # aws-cli/2.x.x Python/3.x.x Windows/...
   ```

---

## 2. Activar IAM Identity Center

IAM Identity Center permite hacer login por navegador — sin access keys estáticas.
Hacerlo una vez desde la cuenta management (502768731030).

> **Región:** IAM Identity Center es regional. Actívalo en `eu-west-1` (Ireland).

1. Busca **IAM Identity Center** en la consola
2. Clic en **Enable** → selecciona **Enable with AWS Organizations**
3. Una vez activado, ve a **Settings** → sección **Identity source** y copia la **AWS access portal URL**
   - Instance URL: `https://identitycenter.amazonaws.com/ssoins-6804aea6a287996d`
   - Access portal URL: la encuentras en Settings, formato `https://d-93679a5478.awsapps.com/start` — **esta es la que usa el CLI**
4. En **Settings** → sección **Authentication** → activa **Send email OTP for users created from API**

---

## 3. Crear un usuario en Identity Center

1. **IAM Identity Center** → **Users** → **Add user**
2. Rellena los datos (usa tu email `edwinmenfor2000@gmail.com`)
3. Recibirás un email para activar el usuario — actívalo
4. Una vez activado, añade el usuario al grupo **Admin**:
   **Groups** → **Admin** → **Add users** → selecciona tu usuario

---

## 4. Dar acceso a las cuentas

Los permisos se asignan al grupo **Admin**, no al usuario directamente.

1. **IAM Identity Center** → **AWS accounts**
2. Selecciona la cuenta management → **Assign users or groups**
3. Pestaña **Groups** → selecciona **Admin** → **Next**
4. Crea un nuevo **Permission set**:
   - Tipo: `AdministratorAccess`
   - **Session duration: 12 hours**
   - Nombre: `AdministratorAccess`
   - Tags: `Project` = `sigmetum`
   - **Create**
5. Asigna el permission set al grupo **Admin** → **Submit**
6. Repite para las cuentas `sigmetum-preprod` y `sigmetum-prod` cuando las tengas

---

## 5. Configurar los perfiles SSO en el CLI

> Haz esto después de haber creado las cuentas preprod y prod en Organizations y de haberles asignado el grupo **Admin** (paso 4 de este doc).

Corre `aws configure sso` **dos veces** — una por cuenta:

```powershell
aws configure sso
```

**Primera vez — perfil preprod:**
```
SSO session name:          sigmetum
SSO start URL:             https://d-93679a5478.awsapps.com/start
SSO region:                eu-west-1
SSO registration scopes:   sso:account:access
```

Se abrirá el navegador → aprueba el acceso. Luego el CLI lista las cuentas disponibles y pide los valores del perfil:

```
Account: 798092528785 (sigmetum-preprod)
Role:    AdministratorAccess
CLI default client Region [None]: eu-west-1
CLI default output format [None]: json
CLI profile name [...]:           sigmetum-preprod
```

**Segunda vez — perfil prod:**
```powershell
aws configure sso
```
```
SSO session name:          sigmetum          ← misma sesión, no la recrea
SSO start URL:             https://d-93679a5478.awsapps.com/start
SSO region:                eu-west-1
SSO registration scopes:   sso:account:access
```
```
Account: ID-PROD (sigmetum-prod)
Role:    AdministratorAccess
CLI default client Region [None]: eu-west-1
CLI default output format [None]: json
CLI profile name [...]:           sigmetum-prod
```

El resultado en `~/.aws/config` queda así:

```ini
[profile sigmetum-preprod]
sso_session = sigmetum
sso_account_id = 798092528785
sso_role_name = AdministratorAccess
region = eu-west-1

[profile sigmetum-prod]
sso_session = sigmetum
sso_account_id = ID-PROD
sso_role_name = AdministratorAccess
region = eu-west-1

[sso-session sigmetum]
sso_start_url = https://d-93679a5478.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access
```

---

## 6. Hacer login

Una sola sesión activa los dos perfiles (duran **12 horas**):

```powershell
aws sso login --sso-session sigmetum
```

O equivalente por perfil (útil si quieres renovar solo uno):

```powershell
aws sso login --profile sigmetum-preprod
aws sso login --profile sigmetum-prod
```

Se abre el navegador, confirmas y ya tienes credenciales temporales activas.

Verifica que cada perfil apunta a la cuenta correcta:

```powershell
aws sts get-caller-identity --profile sigmetum-preprod
aws sts get-caller-identity --profile sigmetum-prod
```

---

## 7. Usar los perfiles con Terraform

Con perfiles SSO directos a cada cuenta no hace falta `assume_role` en el provider — el perfil ya autentifica en la cuenta correcta.

**Dev (preprod):**
```powershell
cd environments/dev
$env:AWS_PROFILE = "sigmetum-preprod"
terraform init
terraform apply
```

**Prod:**
```powershell
cd environments/prod
$env:AWS_PROFILE = "sigmetum-prod"
terraform init
terraform apply
```

---

## Siguiente paso

Con el CLI configurado, sigue con [aws-organizations-setup.md](aws-organizations-setup.md) para crear las cuentas preprod y prod.
