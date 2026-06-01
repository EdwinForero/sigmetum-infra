# AWS Organizations — Multi-Account Setup

Crea cuentas separadas para preprod y prod. Un error en preprod nunca toca prod y los costos quedan aislados por cuenta.

```
cuenta management (502768731030)   ← desde aquí corres Terraform
    ├── sigmetum-preprod            ← environments/dev
    └── sigmetum-prod               ← environments/prod
```

> **Región en la consola:** verifica siempre que esté en `eu-west-1` (Ireland) antes de hacer cualquier cosa.

---

## 1. Activar AWS Organizations

1. Busca **AWS Organizations** en la consola (desde tu cuenta 502768731030)
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
| sigmetum-preprod | `798092528785` |
| sigmetum-prod | *(anotar aquí)* |

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

Cada cuenta tiene su propio bucket — el estado de prod nunca sale de la cuenta de prod.

**preprod:**
```
aws s3api create-bucket --bucket sigmetum-tfstate-preprod --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1 --profile sigmetum-preprod

aws s3api put-bucket-versioning --bucket sigmetum-tfstate-preprod --versioning-configuration Status=Enabled --profile sigmetum-preprod

aws s3api put-bucket-tagging --bucket sigmetum-tfstate-preprod --tagging "TagSet=[{Key=Project,Value=sigmetum},{Key=Environment,Value=preprod},{Key=Component,Value=infrastructure},{Key=ManagedBy,Value=manual}]" --profile sigmetum-preprod
```

**prod:**
```
aws s3api create-bucket --bucket sigmetum-tfstate-prod --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1 --profile sigmetum-prod

aws s3api put-bucket-versioning --bucket sigmetum-tfstate-prod --versioning-configuration Status=Enabled --profile sigmetum-prod

aws s3api put-bucket-tagging --bucket sigmetum-tfstate-prod --tagging "TagSet=[{Key=Project,Value=sigmetum},{Key=Environment,Value=prod},{Key=Component,Value=infrastructure},{Key=ManagedBy,Value=manual}]" --profile sigmetum-prod
```

Resultado:
```
sigmetum-preprod  →  sigmetum-tfstate-preprod/terraform.tfstate
sigmetum-prod     →  sigmetum-tfstate-prod/terraform.tfstate
```

---

## 6. Crear los roles de Beanstalk en cada cuenta

Los roles `aws-elasticbeanstalk-ec2-role` y `aws-elasticbeanstalk-service-role` deben existir en **cada cuenta miembro** (preprod y prod), no en la management.

La forma más fácil es acceder a cada cuenta desde la consola y dejar que el wizard de Beanstalk los cree:

1. En **AWS Organizations** → **AWS accounts** → clic en `sigmetum-preprod`
2. Clic en **Access with role: OrganizationAccountAccessRole** — esto te lleva a la consola de esa cuenta
3. Verifica que la región sea `eu-west-1`
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
