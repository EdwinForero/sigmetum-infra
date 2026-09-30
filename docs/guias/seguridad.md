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
| **Secretos de la aplicación** (`JWT_SECRET`, `ADMIN_PASSWORD`, `EMAIL_PASSWORD`, token de GitHub) | Que queden visibles para quien no debe (git, consola, estado de Terraform) |
| **Datos de investigación** (bucket S3) | Borrado accidental, acceso indebido o corrupción |
| **Las cuentas de AWS** (preprod y prod) | Credenciales filtradas o permisos excesivos |
| **El estado de Terraform** | Contiene secretos en claro; quien lo lea los lee |
| **La disponibilidad y la integridad** del backend y del frontend | Tráfico sin cifrar, configuración abierta, cambios sin revisar |

## 2. Reglas

### SEG-1. Ningún secreto en git

- **Por qué:** lo que entra en el historial no se puede retirar de verdad; hay que rotarlo.
- **Regla:** `terraform.tfvars` y el estado están fuera de git; las plantillas `*.example` solo llevan marcadores. No se escriben valores en documentos, scripts, PR ni conversaciones. No se comparten identificadores de cuenta en documentos nuevos (usa `<ID_CUENTA>`).
- **Cómo:** `quality-check` busca claves de AWS, claves privadas, tokens de GitHub, hashes bcrypt y ARN con identificador de cuenta en los `.tf`, ejemplos, documentos y scripts; falla si hay `.tfvars`, `.tfstate`, `.terraform/` o claves versionados; y exige las entradas del `.gitignore`.
- **Estado:** cumple. `terraform.tfvars` no está versionado (verificado) y no se han detectado secretos. Las guías de puesta en marcha contienen identificadores de cuenta (S1).

### SEG-2. Secretos de la aplicación: dónde viven en Beanstalk

- **Por qué:** `app_env_vars` llega a Beanstalk como **propiedades de entorno** del entorno. Quien pueda leer la configuración del entorno (consola o API de Beanstalk) las ve en claro, incluidas `JWT_SECRET`, `EMAIL_PASSWORD` y el hash de `ADMIN_PASSWORD`.
- **Regla:** los secretos deberían vivir en **Parameter Store (SecureString) o Secrets Manager** y llegar a la aplicación con la integración de Beanstalk para secretos (espacio de nombres `aws:elasticbeanstalk:application:environmentsecrets`, **por confirmar** que la plataforma en uso la admita), con permiso de lectura solo para el rol de las instancias. Mientras tanto, se restringe quién tiene acceso de lectura a Beanstalk en cada cuenta.
- **Cómo:** manual. `quality-check` exige `sensitive = true` en `app_env_vars`, que solo protege la salida de Terraform, no la consola de AWS.
- **Estado:** los secretos son propiedades de entorno (verificado en `modules/beanstalk/main.tf`) (S6). Migrarlos exige tocar el backend solo si cambia el modo de lectura (no debería).

### SEG-3. El estado de Terraform contiene secretos

- **Por qué:** `sensitive = true` oculta el valor en la salida, pero el estado guarda los valores en claro (token de GitHub, `app_env_vars`).
- **Regla:** el bucket de estado (uno por cuenta) tiene cifrado, versionado, bloqueo de acceso público y política TLS; solo quien despliega puede leerlo; el `backend "s3"` activa `encrypt` y un bloqueo de concurrencia. El estado nunca se copia a un equipo local ni se pega en una PR.
- **Cómo:** `quality-check` avisa de los `backend` sin `encrypt` ni bloqueo. El resto depende de la cuenta: **(por confirmar)**.
- **Estado:** versionado activado a mano; sin `encrypt` ni bloqueo en `backend.tf` (S3); el procedimiento manual no crea bloqueo de acceso público ni política TLS (S4); quién puede leerlo es **(por confirmar)** (S2).

### SEG-4. IAM: mínimo privilegio

- **Por qué:** un permiso excesivo convierte cualquier fallo en un incidente grande.
- **Regla:**
  - Las políticas nombran acciones y recursos concretos; nunca `Action: *`, `Resource: *` ni `Principal: *` (`quality-check` falla con los comodines).
  - Una cuenta por entorno aísla los roles: el rol `aws-elasticbeanstalk-ec2-role` es el mismo nombre en cada cuenta, y `modules/storage` le añade una política propia del bucket del entorno. Si dos entornos compartieran cuenta, ambos bloques se sumarían en el mismo rol.
  - Terraform se ejecuta con el permiso de administrador de SSO. Para automatizarlo (integración continua), se usa un rol con los permisos justos, no administrador ([iam-role-setup.md](../iam-role-setup.md)).
- **Cómo:** `quality-check` (comodines en políticas); el resto es revisión manual de cada cambio en `modules/storage` y de las políticas gestionadas de los roles de Beanstalk.
- **Estado:** la política de `modules/storage` se limita al bucket del entorno y a cuatro acciones de S3 (verificado), pero da escritura y borrado sobre todo el bucket, incluida la carpeta de recursos públicos del frontend (S7). Los roles se crearon a mano (M3). Terraform corre con administrador de SSO (S14).

### SEG-5. Credenciales de larga duración

- **Por qué:** una clave de acceso no caduca; filtrada, da acceso hasta que alguien la retira.
- **Regla:** ninguna clave de acceso en el código, los ejemplos ni la documentación. Las instancias usan el rol del perfil de instancia; las personas usan SSO. Si se encuentra una clave expuesta, **se rota primero** y después se limpia.
- **Cómo:** `quality-check` busca `AKIA…` y `ASIA…`.
- **Estado:** ninguna clave en el repositorio (verificado). Las plantillas antiguas incluían claves `AWS_ACCESSKEYID` y `AWS_SECRETACCESSKEY` como marcadores; ya se retiraron (R3). **(por confirmar)** si las claves de acceso antiguas que quedaron expuestas en una copia local de la configuración de Elastic Beanstalk ya se rotaron y se desactivaron (S12).

### SEG-6. S3: bucket de datos y recursos públicos

- **Por qué:** el bucket guarda la investigación y, hoy, también los recursos que el frontend necesita públicos.
- **Regla:** bloqueo de acceso público con sus cuatro opciones, cifrado en reposo, versionado, política que exija TLS (`aws:SecureTransport`), registros de acceso y `prevent_destroy`. Los recursos públicos del frontend se sirven con **CloudFront y OAC** (el bucket sigue privado) y no abriendo el bucket.
- **Cómo:** `quality-check` falla en un bucket nuevo sin bloqueo de acceso público, cifrado o versionado; y avisa (deuda) de la política TLS, los registros y `prevent_destroy`.
- **Estado:** bloqueo de acceso público, cifrado AES256 y versionado: sí (verificado). Política TLS y registros de acceso: no (S5). `prevent_destroy`: no (M6). Los recursos públicos no se sirven hoy: el bloqueo de acceso público impide que el navegador los lea (C2), y no hay CloudFront.

### SEG-7. Red y cómputo

- **Por qué:** cada puerto abierto es superficie de ataque.
- **Regla:** SSH cerrado por defecto (solo con un par de claves y una lista de CIDR explícita, nunca `0.0.0.0/0`); IMDSv1 desactivado; los grupos de seguridad los gestiona Beanstalk y cualquier apertura nueva se justifica.
- **Cómo:** `quality-check` falla con `0.0.0.0/0` hacia el puerto 22 o hacia puertos distintos de 80 y 443, y con un valor por defecto de `ssh_key_name`.
- **Estado:** SSH cerrado (`ssh_key_name` vacío por defecto) y IMDSv1 desactivado: sí (verificado). Se usa el VPC por defecto y las instancias tienen IP pública (verificado); los grupos de seguridad no están en Terraform; el cifrado del disco raíz depende del valor por defecto de la cuenta **(por confirmar)** (S13).

### SEG-8. TLS

- **Por qué:** sin HTTPS, contraseñas y token viajan en claro, y el navegador bloquea el contenido mixto.
- **Regla:** HTTPS obligatorio en todo entorno que se use; el ALB con una política TLS moderna; el certificado en la misma región que el proveedor; el puerto 80 solo redirige a HTTPS.
- **Cómo:** `docs-check` avisa de `backend_url` con `http://` y comprueba la región del ARN de ACM en la plantilla.
- **Estado:** prod: listener 443 con la política `ELBSecurityPolicy-TLS13-1-2-2021-06` (verificado). No hay redirección de 80 a 443 en el código (verificado; el efecto real está **por confirmar**) (S8). dev: instancia única sin HTTPS, que rompe el frontend (C4).

### SEG-9. Cabeceras de seguridad y acceso a preproducción (Amplify)

- **Por qué:** limitan el daño si algo falla (XSS, clickjacking) y evitan que preproducción sea pública.
- **Regla:** `customHeaders` de Amplify con `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors` (los orígenes que necesita el frontend, en la sección 6 de [para-infra.md](../../../sigmetum-frontend/docs/integracion/para-infra.md)). La rama de preproducción con autenticación básica de Amplify, si no debe ser pública.
- **Cómo:** manual.
- **Estado:** sin cabeceras definidas (C11). Sin `enable_basic_auth` en la rama de dev (verificado); si preproducción debe ser privada es **(por confirmar)** (S9).

### SEG-10. Amplify y el token de GitHub

- **Por qué:** el token personal clásico con alcance `repo` da acceso de lectura y escritura a **todos** los repositorios de quien lo creó.
- **Regla:** preferir una **GitHub App** (la integración oficial de Amplify) o, como mínimo, un token de alcance mínimo sobre el repositorio del frontend; rotarlo periódicamente y retirarlo de la cuenta personal de quien se marcha.
- **Cómo:** manual. `access_token` es `sensitive = true`.
- **Estado:** el [README](../../README.md#2-github-personal-access-token) pide un token clásico con alcance `repo` (verificado) (S10).

### SEG-11. Varias cuentas, facturación y auditoría

- **Por qué:** separar preprod y prod limita el daño de un error; sin registro de auditoría no se sabe quién cambió qué.
- **Regla:** preprod y prod en cuentas distintas ([aws-organizations-setup.md](../aws-organizations-setup.md)); CloudTrail activo en cada cuenta; alertas de facturación (AWS Budgets); registros de la aplicación en CloudWatch con retención definida.
- **Cómo:** manual; depende de la cuenta.
- **Estado:** cuentas separadas (verificado en la documentación y en los perfiles). CloudTrail y alertas de facturación: **(por confirmar)**; no están en Terraform. Beanstalk no envía los registros a CloudWatch (`StreamLogs = false`, verificado) (S11).

### SEG-12. Si encuentras una vulnerabilidad o un secreto expuesto

1. No la publiques en un issue ni en una PR abierta: díselo directamente a quien mantiene el proyecto.
2. Si hay un secreto expuesto (clave, token, contraseña), **se rota primero** y después se limpia el historial.
3. Se anota en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) una vez resuelta, sin detalles que faciliten reproducirla.

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
- [ ] Para cambios de IAM, red o secretos, se pasa además la revisión `/security-review` de Claude Code.

## 4. Estado actual (revisión del 30/09/2026)

| Comprobación | Resultado |
|---|---|
| Secretos en `.tf`, ejemplos, documentos y scripts | **Ninguno** |
| `terraform.tfvars`, estado y `.terraform/` versionados | **No** |
| Variables con secretos con `sensitive = true` | Sí |
| Identificadores de cuenta en documentos | Sí, en dos guías (S1) |
| Secretos de la aplicación en propiedades de entorno de Beanstalk | Sí (S6) |
| Estado remoto: versionado | Sí (a mano) |
| Estado remoto: cifrado explícito, bloqueo, política TLS, bloqueo de acceso público | No consta (S3, S4) |
| Bucket de datos: bloqueo de acceso público, cifrado, versionado | Sí |
| Bucket de datos: política TLS, registros, `prevent_destroy` | No (S5, M6) |
| Recursos públicos del frontend accesibles | No (C2) |
| Política IAM de `modules/storage` sin comodines | Sí, pero con escritura sobre todo el bucket (S7) |
| Claves de acceso antiguas rotadas | **(por confirmar)** (S12) |
| SSH cerrado por defecto, IMDSv1 desactivado | Sí |
| VPC por defecto, instancias con IP pública | Sí (S13) |
| HTTPS en prod con política TLS 1.3 | Sí; sin redirección de 80 a 443 (S8) |
| HTTPS en dev | No (C4) |
| Cabeceras de seguridad en Amplify | Sin definir (C11) |
| Autenticación básica en preproducción | No (S9) |
| Token de GitHub de alcance `repo` | Sí, clásico (S10) |
| CloudTrail, alertas de facturación, registros en CloudWatch | **(por confirmar)** / registros desactivados (S11) |
| Terraform ejecutado con permiso de administrador | Sí (S14) |

## 5. Mantener esta guía

- Cuando se resuelve un hallazgo citado aquí, se actualiza la regla y la tabla de la sección 4.
- Una comprobación manual que se pueda automatizar pasa a `scripts/quality-check.mjs`.
- Cuando se retira una excepción de `KNOWN_DEBT`, se actualiza su fila.
