# Seguridad de la infraestructura

Normas para no introducir vulnerabilidades en la infraestructura de SIGMETUM-A, con el estado real de cada una. Cada regla dice **qué**, **por qué**, **cómo se comprueba** y **cómo está hoy**.

- Complementa a [buenas-practicas-terraform.md](buenas-practicas-terraform.md) y a [mantenimiento.md](mantenimiento.md).
- Los hallazgos con id están en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md); aquí se **referencian**, no se repiten.
- La seguridad del código del frontend y del backend está en sus propios repositorios; esta guía cubre lo que despliega Terraform.
- Si un cambio contradice una regla de esta guía, **avisa y pregunta** antes de hacerlo.
- **(verificado)** = comprobado contra el código a fecha 30/09/2026. **(por confirmar)** = depende de la cuenta real de AWS o de un repositorio hermano.

## 1. Qué hay que proteger

| Activo | Riesgo principal |
|---|---|
| **Secretos de la aplicación** (`EMAIL_PASSWORD`; en prod, además los del login antiguo hasta su corte; token de GitHub) | Que queden visibles para quien no debe (git, consola, estado de Terraform) |
| **Datos de investigación** (bucket S3) | Borrado accidental, acceso indebido o corrupción |
| **Las cuentas de AWS** (preprod y prod) | Credenciales filtradas o permisos excesivos |
| **El estado de Terraform** | Contiene secretos en claro; quien lo lea los lee |
| **La disponibilidad y la integridad** del backend y del frontend | Tráfico sin cifrar, configuración abierta, cambios sin revisar |

## 2. Reglas

### SEG-1. Ningún secreto en git

- **Por qué:** lo que entra en el historial no se puede retirar de verdad; hay que rotarlo.
- **Regla:** `terraform.tfvars` y el estado están fuera de git; las plantillas `*.example` solo llevan marcadores. No se escriben valores en documentos, scripts, PR ni conversaciones. No se comparten identificadores de cuenta en documentos nuevos (usa `<ID_CUENTA>`).
- **Cómo:** `quality-check` busca claves de AWS, claves privadas, tokens de GitHub, hashes bcrypt y ARN con identificador de cuenta en los `.tf`, ejemplos, documentos y scripts; falla si hay `.tfvars`, `.tfstate`, `.terraform/` o claves versionados; y exige las entradas del `.gitignore`.
- **Estado:** cumple. `terraform.tfvars` no está versionado (verificado) y no se han detectado secretos. Las guías de puesta en marcha usan los marcadores `<ID_CUENTA_GESTION>`, `<ID_CUENTA_DEV>` y `<ID_CUENTA_PROD>`: ya no contienen identificadores de cuenta (S1, resuelto).

### SEG-2. Secretos de la aplicación: dónde viven en Beanstalk

- **Por qué:** `app_env_vars` llega a Beanstalk como **propiedades de entorno** del entorno. Quien pueda leer la configuración del entorno (consola o API de Beanstalk) las ve en claro. Tras revertir la migración a Parameter Store (commit `0885804`, 31/10/2026), los secretos **vuelven a viajar por ahí**; con el corte único a Cognito (03/11/2026), en dev solo queda `EMAIL_PASSWORD`.
- **Regla:** en dev, el único secreto de `app_env_vars` es `EMAIL_PASSWORD` (corte único a Cognito, `S18` en dev); va en el `terraform.tfvars` (nunca en git ni en documentos). Prod conserva en su `tfvars` real las claves del login antiguo hasta su corte propio (`S18-prod`, tras verificar el TOTP con los dos administradores). **S6 casi cerrado en dev; abierto en prod, sin suposiciones:** los secretos viajan como propiedades de entorno de Beanstalk. `for_each = nonsensitive(var.app_env_vars)` (`modules/beanstalk/main.tf`) quita la marca de sensible: **pueden verse en la salida de `terraform plan` y en el estado**. No se asume que el proveedor oculte `setting.value`. Mitigaciones existentes: estado cifrado (`aa4b508`) y la regla de no pegar la salida del `plan` en chats ni en PR; además, se restringe quién tiene acceso de lectura a Beanstalk en cada cuenta.
- **Cómo:** `quality-check` exige `sensitive = true` en `app_env_vars`, que solo protege la salida de Terraform, no la consola de AWS ni el `plan`. Las plantillas `.example` solo llevan marcadores `CHANGE_ME_...` sin forma de hash.
- **Estado:** **S6 casi cerrado en dev; abierto en prod** (03/11/2026; reabierto el 31/10/2026): los secretos vuelven a ser propiedades de entorno (verificado en `modules/beanstalk/main.tf`; efecto en AWS **(por confirmar)** hasta el `apply`). Sin Parameter Store, sin `environmentsecrets` y sin política IAM `sigmetum-ssm-secrets-<env>`. Se cierra del todo cuando prod retire las claves del login antiguo (`S18-prod`).

### SEG-3. El estado de Terraform contiene secretos

- **Por qué:** `sensitive = true` oculta el valor en la salida, pero el estado guarda los valores en claro (token de GitHub, `app_env_vars`). Con la reversión de Parameter Store, los secretos (en dev, `EMAIL_PASSWORD`; en prod, también los del login antiguo) **vuelven a escribirse en el estado** y pueden verse en la salida de `terraform plan`; siguen además en las versiones previas del bucket de estado (versionado), que no se purgan.
- **Regla:** el bucket de estado (uno por cuenta) tiene cifrado, versionado, bloqueo de acceso público y política TLS; solo quien despliega puede leerlo; el `backend "s3"` activa `encrypt` y un bloqueo de concurrencia. El estado nunca se copia a un equipo local ni se pega en una PR.
- **Cómo:** `quality-check` falla (ya no solo avisa) si un `backend` no tiene `encrypt` o el bloqueo. Operación del bloqueo y del cambio de backend: [mantenimiento.md](mantenimiento.md#estado-remoto-aplicar-el-cambio-de-backend-y-operar-el-bloqueo). El resto depende de la cuenta: **(por confirmar)**.
- **Estado:** `backend.tf` cifra y bloquea, resuelto en código (S3; efecto en las cuentas por confirmar hasta el `init -reconfigure`). El procedimiento del bucket ya incluye bloqueo de acceso público y política TLS. dev cumple versionado, bloqueo público y cifrado; faltan política TLS y etiquetas (comprobado el 31/10/2026). prod: por confirmar (S4 parcial). Quién puede leerlo es **(por confirmar)** (S2).

### SEG-4. IAM: mínimo privilegio

- **Por qué:** un permiso excesivo convierte cualquier fallo en un incidente grande.
- **Regla:**
  - Las políticas nombran acciones y recursos concretos; nunca `Action: *`, `Resource: *` ni `Principal: *` en una sentencia `Allow` (`quality-check` falla con los comodines en `Allow`). **Excepción de `Deny` de TLS:** una sentencia `Effect = "Deny"` con `Principal = "*"` y `Action = "s3:*"` (como `DenyInsecureTransport` de `modules/storage`, condición `aws:SecureTransport = false`) solo restringe y no concede nada, así que no incumple la regla; `quality-check` solo vigila `Principal "*"` y `Action` comodín en sentencias `Allow`.
  - Una cuenta por entorno aísla los roles: el rol `aws-elasticbeanstalk-ec2-role` es el mismo nombre en cada cuenta, y `modules/storage` le añade una política propia del bucket del entorno. Si dos entornos compartieran cuenta, ambos bloques se sumarían en el mismo rol.
  - `modules/beanstalk` **no** añade ninguna política IAM al rol de las instancias (la política en línea `sigmetum-ssm-secrets-<env>` de la migración a Parameter Store se retira del código; si llegó a aplicarse en alguna cuenta, su baja es un cambio del `apply`, **por confirmar**).
  - Terraform se ejecuta con el permiso de administrador de SSO. Para automatizarlo (integración continua), se usa un rol con los permisos justos, no administrador ([iam-role-setup.md](../iam-role-setup.md)).
- **Cómo:** `quality-check` (comodines en políticas); el resto es revisión manual de cada cambio en `modules/storage` y de las políticas gestionadas de los roles de Beanstalk.
- **Estado:** la política IAM de `modules/storage` se limita a `GetObject`, `PutObject` y `DeleteObject` sobre `gallery/*` y `data/*`, y a `ListBucket` con condición de `s3:prefix` (`gallery/*`, `data/*`); sin comodines en `Action` y sin acceso a `assets/*` (S7 resuelto en código, verificado en `modules/storage/main.tf`; efecto aplicado **(por confirmar)**). Dependencia del `apply`: el backend debe tratar `AccessDenied` (S15). Los roles se crearon a mano (M3). Terraform corre con administrador de SSO (S14).

### SEG-5. Credenciales de larga duración

- **Por qué:** una clave de acceso no caduca; filtrada, da acceso hasta que alguien la retira.
- **Regla:** ninguna clave de acceso en el código, los ejemplos ni la documentación. Las instancias usan el rol del perfil de instancia; las personas usan SSO. Si se encuentra una clave expuesta, **se rota primero** y después se limpia.
- **Cómo:** `quality-check` busca `AKIA…` y `ASIA…`.
- **Estado:** ninguna clave en el repositorio (verificado). Las plantillas antiguas incluían claves `AWS_ACCESSKEYID` y `AWS_SECRETACCESSKEY` como marcadores; ya se retiraron (R3). **(por confirmar)** si las claves de acceso antiguas que quedaron expuestas en una copia local de la configuración de Elastic Beanstalk ya se rotaron y se desactivaron (S12).

### SEG-6. S3: bucket de datos y recursos públicos

- **Por qué:** el bucket guarda la investigación y, hoy, también los recursos que el frontend necesita públicos.
- **Regla:** bloqueo de acceso público con sus cuatro opciones, cifrado en reposo, versionado, política que exija TLS (`aws:SecureTransport`), registros de acceso y `prevent_destroy`. Los recursos públicos del frontend se sirven con **CloudFront y OAC** (el bucket sigue privado) y no abriendo el bucket.
- **Cómo:** `quality-check` falla en un bucket nuevo sin bloqueo de acceso público, cifrado o versionado; y avisa (deuda) de la política TLS, los registros y `prevent_destroy` (hoy solo queda la excepción de registros del propio bucket de logs, `modules/storage:access_logs`, M15: no puede registrarse a sí mismo).
- **Estado:** bloqueo de acceso público, cifrado AES256 y versionado: sí (verificado). Política TLS (sentencia `DenyInsecureTransport`) y `prevent_destroy`: sí en código (verificado; S5 parcial y M6 resuelto en código; efecto aplicado **(por confirmar)**). Registros de acceso: sí en código (S5 resuelto en código): `aws_s3_bucket_logging.app` envía los del bucket de datos, con el prefijo `app-data/`, a un bucket de logs por entorno (`sigmetum-access-logs-<entorno>`), y `aws_s3_bucket_logging.eb_staging` hace lo mismo con el bucket de staging de Beanstalk (prefijo `beanstalk-staging/`, M11 resuelto en código). El bucket de logs tiene bloqueo público, cifrado AES256, versionado, `prevent_destroy`, política con `Deny` de TLS y `Allow` solo para `logging.s3.amazonaws.com` (condiciones `aws:SourceArn` y `aws:SourceAccount`) y expiración a los noventa días; no se registra a sí mismo (M15). Los logs contienen IP de visitantes y claves de objeto. Efecto aplicado y aparición de logs: **(por confirmar)** tras el `apply` y unas horas. Ciclo de vida: versiones no actuales a 180 días y multipart incompleto a 7 días (M6). Los recursos públicos se sirven por CloudFront con OAC (`modules/storage/main.tf`, verificado): el bucket sigue privado y `AllowCloudFrontOAC` solo da `s3:GetObject` a la distribución sobre `assets/*` (C13 resuelto en código; efecto **(por confirmar)** tras el `apply` en dev). Nada sube aún `assets/…` (C7).

### SEG-7. Red y cómputo

- **Por qué:** cada puerto abierto es superficie de ataque.
- **Regla:** SSH cerrado por defecto (solo con un par de claves y una lista de CIDR explícita, nunca `0.0.0.0/0`); IMDSv1 desactivado; los grupos de seguridad los gestiona Beanstalk (salvo el de la instancia de `dev`, que está en Terraform y admite HTTP solo desde CloudFront) y cualquier apertura nueva se justifica.
- **Cómo:** `quality-check` falla con `0.0.0.0/0` hacia el puerto 22 o hacia puertos distintos de 80 y 443, y con un valor por defecto de `ssh_key_name`.
- **Estado:** SSH cerrado (`ssh_key_name` vacío por defecto) y IMDSv1 desactivado: sí (verificado). Se usa el VPC por defecto y las instancias tienen IP pública (verificado); los grupos de seguridad no están en Terraform, salvo el de la instancia de `dev` (puerto 80 solo desde CloudFront y salida abierta justificada por SMTP y S3; resuelto en código, pendiente del `apply` y de la puerta de decisión: ver S17 del estado, por confirmar); el cifrado del disco raíz depende del valor por defecto de la cuenta **(por confirmar)** (S13).

### SEG-8. TLS

- **Por qué:** sin HTTPS, contraseñas y token viajan en claro, y el navegador bloquea el contenido mixto.
- **Regla:** HTTPS obligatorio en todo entorno que se use; el ALB con una política TLS moderna; el certificado en la misma región que el proveedor; el puerto 80 solo redirige a HTTPS.
- **Cómo:** `docs-check` avisa de `backend_url` con `http://` y comprueba la región del ARN de ACM en la plantilla.
- **Estado:** prod: listener 443 con la política `ELBSecurityPolicy-TLS13-1-2-2021-06` (verificado). Redirección 301 de 80 a 443 en el listener 80 solo con ALB y certificado (`aws_lb_listener_rule.http_to_https`, verificado en código; S8 resuelto en código); efecto en prod **(por confirmar)** hasta el `apply` en prod, y se pierde si Beanstalk recrea el listener (S16). dev: instancia única sin HTTPS, que rompe el frontend (C4). Frontend de prod: dominio propio (`sigmetum-a.org` y `www`) asociado en `modules/amplify` (C9 resuelto en código), con certificado gestionado por Amplify y validación por DNS (CNAME en Route53 creado por Terraform) y el apex como alias A (un CNAME no se permite en el apex) **(verificado en código)**; HSTS de un día (`max-age=86400`) sin `includeSubDomains` ni `preload`, a propósito mientras el dominio sea nuevo; efecto en AWS **(por confirmar)** hasta el `apply` en prod, y la validación del certificado no avisa si no cierra (`wait_for_verification = false`).

### SEG-9. Cabeceras de seguridad y acceso a preproducción (Amplify)

- **Por qué:** limitan el daño si algo falla (XSS, clickjacking) y evitan que preproducción sea pública.
- **Regla:** `customHeaders` de Amplify con `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors` (los orígenes que necesita el frontend, en la sección 6 de [para-infra.md](../../../sigmetum-frontend/docs/integracion/para-infra.md)). La rama de preproducción con autenticación básica de Amplify, si no debe ser pública.
- **Cómo:** manual.
- **Estado:** cabeceras definidas en código en `dev` y `prod` (C11 resuelto en código, 31/10/2026): HSTS de un día, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y `Content-Security-Policy-Report-Only` con `frame-ancestors 'none'`. **La CSP solo informa (Report-Only), no bloquea**, y no hay endpoint de informes: las violaciones solo se ven en la consola del navegador; se espera una por el `onload` inline de `index.html` (tarea del frontend) y `style-src` conserva `'unsafe-inline'`. Efecto en AWS **(por confirmar)** hasta el `apply` y un build nuevo. Sin `enable_basic_auth` en la rama de dev (verificado); si preproducción debe ser privada es **(por confirmar)** (S9).

### SEG-10. Amplify y el token de GitHub

- **Por qué:** el token personal clásico con alcance `repo` da acceso de lectura y escritura a **todos** los repositorios de quien lo creó.
- **Regla:** preferir una **GitHub App** (la integración oficial de Amplify) o, como mínimo, un token de alcance mínimo sobre el repositorio del frontend; rotarlo periódicamente y retirarlo de la cuenta personal de quien se marcha.
- **Cómo:** manual. `access_token` es `sensitive = true`.
- **Estado:** el [README](../../README.md#2-token-de-acceso-personal-de-github) pide un token clásico con alcance `repo` (verificado) (S10).

### SEG-11. Varias cuentas, facturación y auditoría

- **Por qué:** separar preprod y prod limita el daño de un error; sin registro de auditoría no se sabe quién cambió qué.
- **Regla:** preprod y prod en cuentas distintas ([aws-organizations-setup.md](../aws-organizations-setup.md)); CloudTrail activo en cada cuenta; alertas de facturación (AWS Budgets); registros de la aplicación en CloudWatch con retención definida.
- **Cómo:** manual; depende de la cuenta.
- **Estado:** cuentas separadas (verificado en la documentación y en los perfiles). CloudTrail y alertas de facturación: **(por confirmar)**; no están en Terraform. Beanstalk no envía los registros a CloudWatch (`StreamLogs = false`, verificado) (S11).

### SEG-12. Si encuentras una vulnerabilidad o un secreto expuesto

1. No la publiques en un issue ni en una PR abierta: díselo directamente a quien mantiene el proyecto.
2. Si hay un secreto expuesto (clave, token, contraseña), **se rota primero** y después se limpia el historial.
3. Se anota en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) una vez resuelta, sin detalles que faciliten reproducirla.

### SEG-13. Login de administrador con Cognito (propuesto)

- **Por qué:** el login antiguo (HS256 con firma propia y un hash de contraseña en variables de entorno) concentraba los secretos en Beanstalk; en dev ya no los tiene tras el corte único. Cognito los saca de ahí, pero el cambio de modelo debe ser verificable.
- **Regla (controles de infraestructura verificables):** MFA TOTP `ON` (`mfa_configuration = "ON"`); registro cerrado (`allow_admin_create_user_only = true`); cliente sin secreto (`generate_secret = false`); `deletion_protection` activa en `prod`; ninguna dirección de retorno `localhost` (los retornos salen de `site_origins`); sin comodines ni secretos en el módulo. **PKCE (`code_challenge` S256 y `code_verifier`) es un requisito del frontend, no comprobable desde infra:** Terraform no lo impone ni lo verifica.
- **Riesgos aceptados:** **C16**, el backend no valida `client_id` ni grupos: cualquier usuario del pool es administrador, válido solo con el registro cerrado y un pool de solo administradores. `dev` sin `deletion_protection` (aceptado). `username_attributes = ["email"]` es inmutable y reemplazaría el pool. Con `admin_only` y un solo administrador, perder el TOTP bloquea el acceso: hay un segundo administrador de emergencia por procedimiento humano.
- **Cómo:** `quality-check` **falla** (comprobación automática) si en `modules/cognito` el pool no tiene MFA `ON` con TOTP (`software_token_mfa_configuration` con `enabled = true`), si no tiene el alta solo por administrador (`allow_admin_create_user_only = true`), si el cliente no tiene `generate_secret = false` o permite `ALLOW_USER_PASSWORD_AUTH` o `ALLOW_ADMIN_USER_PASSWORD_AUTH` (sin flujos de contraseña por API; solo Hosted UI), o si algún `.tf` de `modules/cognito/` o `environments/` contiene `localhost`; además vigila comodines, secretos y la etiqueta `Component` del pool. **No comprueba** PKCE (requisito del frontend, fuera de infra) ni `deletion_protection` en `prod`, que se revisa a mano. Detalle en [mantenimiento.md](mantenimiento.md#lo-que-comprueba-node-scriptsquality-checkmjs). El procedimiento y el orden de despliegue están en [para-backend.md](../integracion/para-backend.md#procedimiento-humano-de-alta-de-administrador). En dev el login antiguo se retira con el corte único; en prod no hasta verificar el TOTP (`S18-prod`).
- **Estado:** módulo en código (verificado con `validate`; atributos del proveedor y disponibilidad en `eu-west-3` **(por confirmar)**); efecto en AWS **(por confirmar)** hasta el `apply`.

## 3. Lista de comprobación para una PR

Márcala **siempre** que el cambio toque IAM, S3, secretos, red, TLS, Amplify o variables sensibles.

- [ ] `node scripts/quality-check.mjs` en verde; la deuda nueva, registrada en `KNOWN_DEBT` y en `estado-y-deuda-tecnica.md`.
- [ ] Sin secretos, hashes ni identificadores de cuenta en `.tf`, ejemplos, documentos ni la PR.
- [ ] Variables con secretos: `sensitive = true`; outputs sin valores sensibles.
- [ ] Políticas IAM con acciones y recursos concretos; ningún comodín.
- [ ] Buckets nuevos con bloqueo de acceso público, cifrado, versionado, política TLS y `prevent_destroy` si guardan datos.
- [ ] Ningún puerto nuevo abierto a `0.0.0.0/0`; SSH sigue cerrado.
- [ ] HTTPS en lo que sirva tráfico real; certificado en la región del proveedor.
- [ ] Sin `terraform apply` ni `destroy` sin confirmación expresa; `plan` sin pegar en la PR.
- [ ] Si hay que rotar un secreto, la PR lo dice y dice quién debe hacerlo (solo nombres de variables).
- [ ] Si toca Cognito: MFA `ON`, registro cerrado, cliente sin secreto, sin `localhost` y `deletion_protection` en `prod` (SEG-13).
- [ ] Para cambios de IAM, red o secretos, se pasa además la revisión `/security-review` de Claude Code.

## 4. Estado actual (revisión del 30/09/2026)

| Comprobación | Resultado |
|---|---|
| Secretos en `.tf`, ejemplos, documentos y scripts | **Ninguno** |
| `terraform.tfvars`, estado y `.terraform/` versionados | **No** |
| Variables con secretos con `sensitive = true` | Sí |
| Identificadores de cuenta en documentos | Ninguno (S1, resuelto) |
| Secretos de la aplicación en propiedades de entorno de Beanstalk | **Sí, en código**: `EMAIL_PASSWORD` es el único secreto de dev y puede verse en `plan` y en el estado; prod conserva las claves del login antiguo hasta su corte (S6 casi cerrado en dev, abierto en prod; `S18-prod`) |
| Estado remoto: versionado | Sí (a mano) |
| Estado remoto: cifrado explícito, bloqueo, política TLS, bloqueo de acceso público | Parcial: cifrado y bloqueo en código; política TLS por aplicar en dev y por confirmar en prod (S3, S4) |
| Bucket de datos: bloqueo de acceso público, cifrado, versionado | Sí |
| Bucket de datos: política TLS, `prevent_destroy`, ciclo de vida | Sí en código (S5 parcial, M6); efecto por confirmar |
| Bucket de datos y de staging: registros de acceso, bucket de logs con TLS y retención de noventa días | Sí en código (S5, M11); entrega por confirmar |
| Recursos públicos del frontend por CloudFront con OAC (bucket privado) | Sí en código (C2 resuelto); `assets/…` subidos en `dev` (verificado 31/10/2026) y, en `prod`, pendientes de la subida con `scripts/sync-assets.mjs` (C7); política de CloudFront solo sobre `assets/*` (C13 resuelto en código; efecto por confirmar) |
| Política IAM de `modules/storage` sin comodines | Sí, acotada a `gallery/*` y `data/*` (S7 resuelto en código; efecto por confirmar) |
| Claves de acceso antiguas rotadas | **(por confirmar)** (S12) |
| SSH cerrado por defecto, IMDSv1 desactivado | Sí |
| VPC por defecto, instancias con IP pública | Sí (S13) |
| HTTPS en prod con política TLS 1.3 | Sí; redirección de 80 a 443 en código (S8); efecto en prod por confirmar |
| HTTPS en dev | Sí, CloudFront delante de Beanstalk (C4 resuelto) |
| Cabeceras de seguridad en Amplify | Definidas en código (C11); CSP solo en Report-Only, no bloquea; HSTS de un día sin `includeSubDomains` ni `preload`; efecto por confirmar |
| Dominio propio de prod con TLS gestionado por Amplify | Sí en código (C9); validación del certificado por DNS y apex como alias; efecto en prod por confirmar |
| Autenticación básica en preproducción | No (S9) |
| Token de GitHub de alcance `repo` | Sí, clásico (S10) |
| CloudTrail, alertas de facturación, registros en CloudWatch | **(por confirmar)** / registros desactivados (S11) |
| Terraform ejecutado con permiso de administrador | Sí (S14) |
| Login de administrador con Cognito (SEG-13): MFA `ON` con TOTP, alta solo por administrador, cliente sin secreto, sin `localhost`, sin flujos de contraseña por API | Comprobado por `quality-check` (falla); PKCE y `deletion_protection` en `prod` no son automáticos; efecto en AWS por confirmar hasta el `apply` |

## 5. Mantener esta guía

- Cuando se resuelve un hallazgo citado aquí, se actualiza la regla y la tabla de la sección 4.
- Una comprobación manual que se pueda automatizar pasa a `scripts/quality-check.mjs`.
- Cuando se retira una excepción de `KNOWN_DEBT`, se actualiza su fila.
