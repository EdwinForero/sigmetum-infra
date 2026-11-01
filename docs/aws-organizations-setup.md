# AWS Organizations — Multi-Account Setup

Crea cuentas separadas para preprod y prod. Un error en preprod nunca toca prod y los costos quedan aislados por cuenta.

```
cuenta management (<ID_CUENTA_GESTION>)   ← desde aquí corres Terraform
    ├── sigmetum-preprod            ← environments/dev
    └── sigmetum-prod               ← environments/prod
```

> **Región en la consola:** verifica siempre que esté en `eu-west-3` (París) antes de hacer cualquier cosa.

---

## 0. Crear la cuenta raíz y configurar MFA

Este paso lo hace el **owner** (la persona que paga la factura de AWS). Solo se hace una vez.

### Crear la cuenta

1. Ve a [aws.amazon.com](https://aws.amazon.com) → **Create an AWS Account**
2. Usa el email del owner — documenta en un gestor de contraseñas que ese email es la cuenta raíz de AWS
3. Completa los datos de facturación (tarjeta del pagador)
4. Elige el plan **Basic (gratuito)** — se puede subir a Business/Enterprise si se necesita soporte de AWS

### Configurar MFA en la cuenta raíz

1. Inicia sesión como root
2. Menú de usuario (arriba a la derecha) → **Security credentials** (no entres a IAM)
3. Sección **Multi-factor authentication (MFA)** → **Assign MFA device**
4. Elige **Authenticator app** (TOTP) — recomendado: Authy o 1Password
5. Escanea el QR y confirma con dos códigos consecutivos

> **La cuenta raíz nunca se usa para el día a día.** Solo sirve para cambiar la facturación, cerrar la cuenta o recuperar acceso de emergencia. Todo el trabajo operativo se hace con el usuario IAM Identity Center del paso 2.

### Activar la alerta de facturación

Hazlo inmediatamente después de crear la cuenta para detectar gastos inesperados:

1. Busca **Billing** en la consola → **Budgets** → **Create budget**
2. Tipo: **Cost budget** → presupuesto mensual de referencia (por ejemplo $50)
3. Añade una alerta al 80 % con notificación por email al owner

---

## 1. Activar AWS Organizations

1. Busca **AWS Organizations** en la consola (desde tu cuenta <ID_CUENTA_GESTION>)
2. Clic en **Create organization**
3. Confirma — tu cuenta pasa a ser la cuenta raíz (management)

---

## 2. Crear las cuentas miembro

Desde **AWS Organizations** → **AWS accounts** → **Add an AWS account** → **Create an AWS account**

Hazlo dos veces con estos datos:

**Cuenta preprod:**
- Account name: `sigmetum-preprod`
- Email: `edwinmenfor2000+preprod@gmail.com`
- IAM role name: deja el valor por defecto → `OrganizationAccountAccessRole`
- En la sección **Tags** del mismo wizard, añade antes de crear:
  - `Project` = `sigmetum`
  - `Environment` = `preprod`
- Clic en **Create AWS account**

**Cuenta prod:**
- Account name: `sigmetum-prod`
- Email: `edwinmenfor2000+prod@gmail.com`
- IAM role name: deja el valor por defecto → `OrganizationAccountAccessRole`
- En la sección **Tags** del mismo wizard, añade antes de crear:
  - `Project` = `sigmetum`
  - `Environment` = `prod`
- Clic en **Create AWS account**

> Los tags de cuenta aparecen en AWS Cost Explorer como **"user:Project"** y **"user:Environment"**. Actívalos en Billing → Cost allocation tags igual que los tags de recursos (ver [billing-tags.md](billing-tags.md)).

> AWS tarda 1-2 minutos en crear cada cuenta. Cuando aparezcan en la lista ya están listas.

---

## 3. Obtener los Account IDs

1. En **AWS Organizations** → **AWS accounts** verás las tres cuentas
2. Anota los IDs de las cuentas nuevas:

| Cuenta | Account ID |
|---|---|
| sigmetum-preprod | `<ID_CUENTA_DEV>` |
| sigmetum-prod | `<ID_CUENTA_PROD>` |

---

## 4. Configurar los perfiles SSO del CLI

Asigna el grupo **Admin** a cada cuenta nueva en Identity Center y configura los perfiles con los Account IDs del paso anterior. Ver [aws-cli-setup.md](aws-cli-setup.md#5-configurar-los-perfiles-sso-en-el-cli).

Verifica que cada perfil apunta a la cuenta correcta antes de continuar:

```
aws sts get-caller-identity --profile sigmetum-preprod
aws sts get-caller-identity --profile sigmetum-prod
```

---

## 5. Crear los buckets de Terraform state

Cada cuenta tiene su propio bucket: el estado de prod nunca sale de la cuenta de prod. El procedimiento sirve para cuentas nuevas y para completar las que ya tienen bucket. Se aplica a cada cuenta con su perfil (`--profile sigmetum-preprod` o `--profile sigmetum-prod`); los ejemplos son de dev y, en prod, cambian el nombre del bucket (`sigmetum-tfstate-prod`), el perfil y el valor de `Environment`. Los pasos 2 a 4 los añadió la revisión del 31/10/2026 (S4); el cifrado y el bloqueo de concurrencia del estado los activa `backend.tf` (S3, ver [mantenimiento.md](guias/mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo)).

**1. Crear el bucket y activar el versionado:**
```
aws s3api create-bucket --bucket sigmetum-tfstate-dev --region eu-west-3 --create-bucket-configuration LocationConstraint=eu-west-3 --profile sigmetum-preprod

aws s3api put-bucket-versioning --bucket sigmetum-tfstate-dev --versioning-configuration Status=Enabled --profile sigmetum-preprod
```

**2. Bloquear el acceso público:**
```
aws s3api put-public-access-block --bucket sigmetum-tfstate-dev --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --profile sigmetum-preprod
```

**3. Cifrado AES256 por defecto.** Crea un archivo temporal `tfstate-encryption.json` con este contenido (con `file://` se evitan los problemas de comillas de PowerShell):
```
{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}
```
```
aws s3api put-bucket-encryption --bucket sigmetum-tfstate-dev --server-side-encryption-configuration file://tfstate-encryption.json --profile sigmetum-preprod
```

**4. Política que exige TLS.** Archivo temporal `tfstate-tls-policy.json` (en prod, los dos nombres de `Resource` son los de `sigmetum-tfstate-prod`):
```
{"Version":"2012-10-17","Statement":[{"Sid":"DenyNonTLS","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::sigmetum-tfstate-dev","arn:aws:s3:::sigmetum-tfstate-dev/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
```
```
aws s3api put-bucket-policy --bucket sigmetum-tfstate-dev --policy file://tfstate-tls-policy.json --profile sigmetum-preprod
```
El `Deny` solo rechaza las peticiones sin TLS: Terraform y la consola usan HTTPS, así que no los afecta y tampoco impide quitar la política. Comprueba con `get-bucket-policy` justo después; un cliente HTTP (poco habitual) quedaría rechazado.

**5. Etiquetas:**
```
aws s3api put-bucket-tagging --bucket sigmetum-tfstate-dev --tagging "TagSet=[{Key=Project,Value=sigmetum},{Key=Environment,Value=preprod},{Key=Component,Value=infrastructure},{Key=ManagedBy,Value=manual}]" --profile sigmetum-preprod
```

Los `.json` son temporales: bórralos al terminar y no los versiones. En prod, el mismo procedimiento con `sigmetum-tfstate-prod`, `--profile sigmetum-prod` y `Value=prod` en `Environment`.

Resultado:
```
sigmetum-preprod  →  sigmetum-tfstate-dev/terraform.tfstate
sigmetum-prod     →  sigmetum-tfstate-prod/terraform.tfstate
```

### Comprobar un bucket (solo lectura)

Estos comandos no cambian nada. **dev:**
```
aws s3api get-bucket-versioning --bucket sigmetum-tfstate-dev --expected-bucket-owner <ID_CUENTA_DEV> --profile sigmetum-preprod
aws s3api get-public-access-block --bucket sigmetum-tfstate-dev --expected-bucket-owner <ID_CUENTA_DEV> --profile sigmetum-preprod
aws s3api get-bucket-encryption --bucket sigmetum-tfstate-dev --expected-bucket-owner <ID_CUENTA_DEV> --profile sigmetum-preprod
aws s3api get-bucket-policy --bucket sigmetum-tfstate-dev --expected-bucket-owner <ID_CUENTA_DEV> --profile sigmetum-preprod
aws s3api get-bucket-tagging --bucket sigmetum-tfstate-dev --expected-bucket-owner <ID_CUENTA_DEV> --profile sigmetum-preprod
```
**prod:** los mismos cinco con `--bucket sigmetum-tfstate-prod --expected-bucket-owner <ID_CUENTA_PROD> --profile sigmetum-prod`.

| Comando | Resultado esperado | Si falta |
|---|---|---|
| `get-bucket-versioning` | `Status: Enabled` | Paso 1 (`put-bucket-versioning`) |
| `get-public-access-block` | Las cuatro opciones a `true` | Paso 2 |
| `get-bucket-encryption` | `SSEAlgorithm: AES256` | Paso 3 |
| `get-bucket-policy` | Sentencia `Deny` con `aws:SecureTransport` a `false` (si no hay política, error `NoSuchBucketPolicy`) | Paso 4 |
| `get-bucket-tagging` | Las cuatro etiquetas (si no hay, error `NoSuchTagSet`) | Paso 5 |

### Estado de cada cuenta

| Cuenta | Versionado | Bloqueo público | Cifrado AES256 | Política TLS | Etiquetas |
|---|---|---|---|---|---|
| dev (`sigmetum-preprod`), comprobado el 31/10/2026 | Cumple | Cumple | Cumple | **Falta** | **Faltan** |
| prod (`sigmetum-prod`) | (por confirmar) | (por confirmar) | (por confirmar) | (por confirmar) | (por confirmar) |

La política TLS y las etiquetas de dev las aplica una persona con confirmación expresa; ningún rol del ciclo agéntico lo hace. El hallazgo S4 pasa a resuelto por cuenta cuando la comprobación de solo lectura muestra los cinco controles.

---

## 6. Crear los roles de Beanstalk en cada cuenta

Los roles `aws-elasticbeanstalk-ec2-role` y `aws-elasticbeanstalk-service-role` deben existir en **cada cuenta miembro** (preprod y prod), no en la management.

La forma más fácil es acceder a cada cuenta desde la consola y dejar que el wizard de Beanstalk los cree:

1. En **AWS Organizations** → **AWS accounts** → clic en `sigmetum-preprod`
2. Clic en **Access with role: OrganizationAccountAccessRole** — esto te lleva a la consola de esa cuenta
3. Verifica que la región sea `eu-west-3`
4. Ve a **Elastic Beanstalk** → **Create application** → sigue el wizard hasta ver los roles creados → **Cancel**
5. Repite para `sigmetum-prod`

O por CLI — ejecuta los comandos con el perfil de cada cuenta:

**preprod:**
```
aws iam create-role --role-name aws-elasticbeanstalk-service-role --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"elasticbeanstalk.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}" --tags Key=Project,Value=sigmetum Key=Component,Value=backend Key=ManagedBy,Value=manual --profile sigmetum-preprod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth --profile sigmetum-preprod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy --profile sigmetum-preprod

aws iam create-role --role-name aws-elasticbeanstalk-ec2-role --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}" --tags Key=Project,Value=sigmetum Key=Component,Value=backend Key=ManagedBy,Value=manual --profile sigmetum-preprod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier --profile sigmetum-preprod

aws iam create-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --profile sigmetum-preprod

aws iam add-role-to-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --role-name aws-elasticbeanstalk-ec2-role --profile sigmetum-preprod
```

**prod:**
```
aws iam create-role --role-name aws-elasticbeanstalk-service-role --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"elasticbeanstalk.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}" --tags Key=Project,Value=sigmetum Key=Component,Value=backend Key=ManagedBy,Value=manual --profile sigmetum-prod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth --profile sigmetum-prod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy --profile sigmetum-prod

aws iam create-role --role-name aws-elasticbeanstalk-ec2-role --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}" --tags Key=Project,Value=sigmetum Key=Component,Value=backend Key=ManagedBy,Value=manual --profile sigmetum-prod

aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier --profile sigmetum-prod

aws iam create-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --profile sigmetum-prod

aws iam add-role-to-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --role-name aws-elasticbeanstalk-ec2-role --profile sigmetum-prod
```

---

## Siguiente paso

Con las cuentas creadas y los roles listos, sigue con el deploy en [README.md](../README.md#first-time-deploy).
