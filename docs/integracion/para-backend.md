# Integración con el backend: lo que ofrece y necesita la infraestructura

Documento para quien mantiene `sigmetum-backend`. Convención y estructura en [mantenimiento.md](../guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios) (compartida por los tres repositorios). El backend no tiene un documento `para-infra.md` equivalente: su contrato con esta infraestructura es `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js`, que se citan aquí.

- Lo verificado contra el código de Terraform y del backend está marcado como **(verificado)**. Lo que depende de la cuenta real de AWS, como **(por confirmar)**.
- Fecha de la verificación: 30/09/2026 (actualizado 31/10/2026, secretos en Parameter Store, `TRUST_PROXY_HOPS`, restricción del origen de `dev` a CloudFront y `ALLOWED_ORIGIN` de prod con dos orígenes). Infraestructura: rama `feature/testing`, commit base `cee5e23` (cambios sin commitear). Backend: rama `feature/sigmetum_v2`, commit `a2dadb9`.

## 1. Resumen

| Id | Problema | Efecto | Estado |
|---|---|---|---|
| ~~**infra:C5**~~ | ~~`app_env_vars` no incluía `ALLOWED_ORIGIN`, `ADMIN_USERNAME` ni `ADMIN_PASSWORD`~~ | ~~El backend no arranca~~ | **Resuelto** — plantillas `.example` y referencia incluyen todas las obligatorias **(verificado)** |
| ~~**infra:C6**~~ | ~~`HealthCheckPath` de Beanstalk es `/`~~ | ~~El entorno puede figurar como no saludable~~ | **Resuelto** (`feature/testing` de infra): `HealthCheckPath = "/healthcheck"` **(verificado)** |
| ~~**backend:B1**~~ | ~~El backend no configuraba `trust proxy`~~ | ~~IP del balanceador compartida por todos los usuarios en el rate-limiter~~ | **Resuelto (03/10/2026)**: `app.set('trust proxy', ...)` en `app.js`, con los saltos fijados por `TRUST_PROXY_HOPS` (1 si no se define) **(verificado)** |
| **backend:I7** | Sin `TRUST_PROXY_HOPS` el backend usa 1 salto por defecto, que es incorrecto en `dev` | Si los saltos reales difieren, el limitador de intentos agrupa mal las IP (en `dev`, todos los visitantes de un extremo de CloudFront comparten cupo) o se esquiva con `X-Forwarded-For` | **Resuelto en el repositorio para `dev` (medido: dos). Pendiente: `apply` del humano y medición en `prod`.** Sigue abierto (prioridad alta) con riesgo residual por `infra:S17` y debe cerrarse **antes de que el backend despliegue la entrega 2 de M21** (`POST /send-email` pública; condición del backend en su `para-infra.md`, sección 6) (no es `frontend:I7`) |
| **infra:S17** | El origen de Beanstalk de `dev` admitía HTTP directo desde cualquier origen (verificado el 31/10/2026 con `curl` y `describe-security-groups`) | Una petición directa al CNAME de Beanstalk salta CloudFront: con el valor dos, `X-Forwarded-For` es falsificable y los límites de login y `/send-email` se esquivan | **Resuelto en código para `dev`, pendiente del `apply` y de la puerta de decisión** (si `curl` directo sigue dando `200`, se revierte y se anota la deuda). Detalle en la sección 4 |
| **infra:S15** (dependencia del `apply`) | El backend ya trata `AccessDenied` como "no existe" en lecturas (`GET /list-terms`, `GET /get-data/:path(*)`), pero no en las rutas que escriben (`upload-term`, `delete-term`), a propósito | Tras acotar `s3:ListBucket` por `Prefix` (infra:S7), una clave inexistente da `AccessDenied` y no `NoSuchKey` **(por confirmar el estado exacto)**. En `dev`, `data/terms/noLatinTerms.json` no existe (verificado el 31/10/2026): `/list-terms` da `200` con lista vacía, pero la primera alta de término fallaría con 500 | **Abierto, para quien despliega**: subir `data/terms/noLatinTerms.json` con `[]` a dev y prod (comando en la sección 5); el backend no cambia |

## 2. Contrato de entorno: `app_env_vars` frente a `validateEnv.js`

El backend exige estas variables al arrancar (`config/validateEnv.js`, verificado). Solo se listan **nombres**, nunca valores. Además de existir, algunas tienen reglas de valor (validación estricta):

Desde la limpieza de deuda M7 (31/10/2026), la variable `app_env_vars` de `modules/beanstalk` se valida en `terraform plan`: exige por nombre las obligatorias de la tabla (sin revelar valores) y acepta claves extra; no comprueba el contenido, que sigue siendo cosa de `validateEnv.js`. Desde la migración de secretos (31/10/2026) la lista que exige son las seis no secretas, y una segunda `validation` **rechaza** `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` en `app_env_vars`. **El contrato de nombres no cambia:** el backend sigue recibiendo las nueve variables con los mismos nombres y las mismas reglas de valor; solo cambia cómo llegan las tres secretas.

| Variable | Exigida por el backend | La define `app_env_vars` hoy | Es secreto |
|---|---|---|---|
| `JWT_SECRET` | Sí | No: llega de Parameter Store | Sí |
| `JWT_EXPIRATION` | Sí | Sí | No |
| `ADMIN_USERNAME` | Sí | Sí | No |
| `ADMIN_PASSWORD` | Sí | No: llega de Parameter Store | Sí (hash bcrypt) |
| `EMAIL` | Sí | Sí | No |
| `EMAIL_PASSWORD` | Sí | No: llega de Parameter Store | Sí |
| `AWS_REGION` | Sí | Sí (`eu-west-3`) | No |
| `AWS_BUCKET_NAME` | Sí | Sí (`sigmetum-app-assets-dev` / `sigmetum-app-assets-prod`) | No |
| `ALLOWED_ORIGIN` | Sí | Sí (vacío en dev hasta conocer la URL de Amplify) | No |
| `AWS_PROFILE` | Solo si `NODE_ENV=local` | No aplica (Beanstalk no usa `NODE_ENV=local`) | No |
| `TRUST_PROXY_HOPS` | No (opcional; 1 si no se define) | Sí (`"2"` en los `.example`; el de `prod` por confirmar, `backend:I7`) | No |

**Efecto operativo de añadir `TRUST_PROXY_HOPS`:** cambia las propiedades de entorno de Beanstalk (un setting nuevo en `aws:elasticbeanstalk:application:environment`), lo que reconfigura el entorno y puede reiniciar la aplicación. El `apply` lo ejecuta el humano. El backend ya soporta la variable (M12), así que no hay despliegue previo en backend ni en frontend. Si el humano copia el `.example` de `prod` sin medir, fija un valor no verificado: mídelo antes (sección 6).

**Reglas de valor (verificado en `config/validateEnv.js` y `config/trustProxy.js`; solo reglas, sin valores):**

- `JWT_SECRET`: al menos 32 caracteres.
- `ADMIN_PASSWORD`: un hash bcrypt completo.
- `JWT_EXPIRATION`: duración con unidad y mayor que cero (un número sin unidad es inválido).
- `TRUST_PROXY_HOPS`: entero de 1 a 5; el 0 solo con `NODE_ENV` `local` o `test`.
- Con `NODE_ENV` distinto de `local` y `test`, un valor inválido **impide el arranque**; con `local` o `test` solo avisa. **No definir `NODE_ENV` como `local` ni `test` en Beanstalk** (estaría relajando la validación).
- Si los valores reales de `terraform.tfvars` cumplen estas reglas: **(por confirmar)**; no se leen. Un valor incumplidor haría que el backend no arranque tras el despliegue.

Las plantillas `environments/*/terraform.tfvars.example` incluyen todas las claves obligatorias. Los `terraform.tfvars` reales (fuera de git) deben tenerlas aplicadas por quien despliega.

**Cómo llegan hoy:**

- **Las claves no secretas** (`app_env_vars`): como propiedades de entorno del entorno de Beanstalk (`dynamic "setting"` sobre `app_env_vars`, namespace `aws:elasticbeanstalk:application:environment`, verificado en `modules/beanstalk/main.tf`).
- **Los tres secretos** (`JWT_SECRET`, `EMAIL_PASSWORD`, `ADMIN_PASSWORD`): desde Parameter Store (`SecureString`, parámetro `/sigmetum/<env>/backend/<CLAVE>`), con un `dynamic "setting"` del espacio de nombres `aws:elasticbeanstalk:application:environmentsecrets` cuyo valor es el ARN del parámetro; la plataforma resuelve el valor en la instancia y el proceso lo ve como variable de entorno con el mismo nombre **(verificado en código; efecto en AWS por confirmar hasta el `apply`; la versión mínima de plataforma, por confirmar)**. Dejan de ser propiedades de entorno en claro (resuelve en código [S6](../estado-y-deuda-tecnica.md#abiertos)). Terraform no crea los parámetros ni lee su valor: los crea el humano antes del `apply`.
- **Efecto operativo:** el `apply` reconfigura el entorno y puede reiniciar la aplicación (en `prod`, con despliegue gradual). Si falta un parámetro, falta el permiso o este no se ha propagado, **el backend no arranca** (falla cerrado). Backend: sin cambios de código.

### Secretos en Parameter Store: procedimiento humano

**(por confirmar)** hasta que se ejecute. Solo nombres y marcadores; **nunca** un valor en un documento, en el historial del terminal ni en `--value` por línea de comandos. `<env>` es `dev` o `prod`; `<CLAVE>` es `JWT_SECRET`, `EMAIL_PASSWORD` o `ADMIN_PASSWORD`; `<perfil>` es el perfil de la cuenta del entorno. Descripción de la política y de las claves: [referencia](../referencia-modulos.md#secretos-en-parameter-store).

**Pre-condiciones del `apply` (por entorno y por cuenta).** Si una falla, no se aplica y se vuelve a requisitos (el backend no se toca):

1. **Plataforma que soporta `environmentsecrets` (por confirmar).** La plataforma desplegada puede diferir de `var.solution_stack_name` (`ignore_changes`). Solo lectura: `aws elasticbeanstalk describe-environments --environment-names sigmetum-backend-<env>-env --query "Environments[0].PlatformArn"` y `aws elasticbeanstalk describe-configuration-options --environment-name sigmetum-backend-<env>-env --query "Options[?Namespace=='aws:elasticbeanstalk:application:environmentsecrets']"`; si esta última no devuelve nada, el entorno no lo soporta.
2. **Los tres parámetros creados y verificados** con los pasos de abajo.
3. **Quien aplica tiene `iam:PutRolePolicy`** sobre `aws-elasticbeanstalk-ec2-role` en esa cuenta.
4. **Riesgo aceptado:** `dev` y `prod` se aplican en la misma sesión, sin puerta intermedia: un fallo que `dev` habría destapado se descubre con `prod` ya aplicándose.

**Crear cada parámetro sin salto de línea final.** Un `file://` con `\n` final guarda un salto de línea en el valor y `validateEnv.js` lo rechaza (un bcrypt lleva `$`, que además no debe expandirse).

- **PowerShell** (la entrada de `Read-Host` no va al historial ni expande `$`; el `finally` borra el temporal y las variables aunque `aws` falle o se cancele con Ctrl+C):
  ```powershell
  $f = Join-Path $env:TEMP "p.tmp"
  try {
    $s = Read-Host -AsSecureString "valor"
    $v = [System.Net.NetworkCredential]::new('', $s).Password
    [IO.File]::WriteAllText($f, $v)
    (Get-Item $f).Length
    Read-Host "Longitud correcta (60 para un bcrypt)? Intro para subir, Ctrl+C para cancelar"
    aws ssm put-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --type SecureString --value "file://$f" --overwrite --profile <perfil>
  } finally {
    Remove-Item $f -ErrorAction SilentlyContinue
    Remove-Variable v,s -ErrorAction SilentlyContinue
  }
  ```
- **Bash** (`printf '%s'` no añade salto; `IFS= read -r` no expande `$` ni recorta espacios; el subshell hace que el `trap` se ejecute al terminar el bloque, también si `aws` falla):
  ```bash
  (
    f=$(mktemp); trap 'rm -f "$f"; unset v' EXIT
    IFS= read -rs v; printf '%s' "$v" > "$f"
    wc -c < "$f"
    read -rp "Longitud correcta (60 para un bcrypt)? Intro para subir, Ctrl+C para cancelar " _
    aws ssm put-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --type SecureString --value "file://$f" --overwrite --profile <perfil>
  )
  ```
- **Git Bash en Windows:** `mktemp` devuelve una ruta `/tmp/...` que `aws.exe` (programa de Windows) puede no resolver con `file://`. Usa `--value "file://$(cygpath -m "$f")"` (ruta con forma `C:/...`) o el procedimiento de PowerShell.
- **Medir el archivo antes de subirlo** (los comandos de arriba ya lo hacen): `(Get-Item $f).Length` en PowerShell y `wc -c < "$f"` en Bash. Un bcrypt debe dar **60**; **61** indica salto de línea final (se repite sin subir). Para `JWT_SECRET` y `EMAIL_PASSWORD` solo se comprueba que no hay un byte de más respecto a lo que se tecleó. Archivo temporal fuera del repositorio y borrado después (no hay borrado seguro garantizado, por confirmar).

**Verificar:**

1. **Que existen:** `aws ssm describe-parameters --parameter-filters "Key=Name,Option=BeginsWith,Values=/sigmetum/<env>/backend/" --profile <perfil>`, sin leer el valor. El campo `Name` empieza por `/`.
2. **El valor sin imprimirlo (por confirmar; exige `ssm:GetParameter` con descifrado al operador):** leerlo a una variable y mostrar solo longitud y prefijo (60 y `$2` para el bcrypt; al menos 32 para `JWT_SECRET`). Sin `echo` del valor.
   - **PowerShell** (si `$v` no es un `string` sino una lista, el valor guardado lleva salto de línea):
     ```powershell
     $v = aws ssm get-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --with-decryption --query "Parameter.Value" --output text --profile <perfil>
     $v -is [string]; $v.Length; $v.Substring(0,2)
     Remove-Variable v
     ```
   - **Bash** (la salida `text` añade un salto, así que un bcrypt correcto da 61 en el `wc` y 60 en `${#v}`; `$(...)` recorta los saltos finales, por eso el `wc` es el que delata uno guardado de más):
     ```bash
     aws ssm get-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --with-decryption --query "Parameter.Value" --output text --profile <perfil> | wc -c
     v=$(aws ssm get-parameter --name "/sigmetum/<env>/backend/<CLAVE>" --with-decryption --query "Parameter.Value" --output text --profile <perfil>); printf '%s %s\n' "${#v}" "${v:0:2}"; unset v
     ```

**Orden de despliegue:**

1. Crear los tres parámetros en cada cuenta (`dev` y `prod`) y verificarlos.
2. Comprobar las pre-condiciones.
3. Quitar `JWT_SECRET`, `EMAIL_PASSWORD` y `ADMIN_PASSWORD` de `app_env_vars` en `terraform.tfvars` de cada entorno (si siguen, `plan` falla por la `validation`).
4. `terraform plan` (el humano lo revisa sin pegar su salida) y `apply` en `dev` y `prod` en la misma sesión.
5. Sin cambios en backend ni en frontend.

**Tras el `apply` (por confirmar):** salud `Ok` y arranque sin error de `validateEnv.js` (exige el bcrypt completo, sin `$` expandido); login real del administrador; con acceso a la instancia (SSH deshabilitado por defecto), `get-config environment -k ADMIN_PASSWORD` comprobando solo la longitud. Y que la configuración del entorno (`describe-configuration-settings`, solo nombres) ya no lista las tres claves en `aws:elasticbeanstalk:application:environment`.

**Si el entorno no se recupera tras el `apply`** (política aún no visible por la propagación de IAM, parámetro ausente o inválido):

1. Solo lectura: `aws elasticbeanstalk describe-events --environment-name sigmetum-backend-<env>-env --max-items 20` y `describe-environments` (`Status`, `Health`).
2. Esperar a `Ready`: Beanstalk revierte una actualización de configuración fallida. No se aborta a mano (`abort-environment-update` cambia recursos y exige confirmación expresa).
3. Repetir `terraform apply` en ese entorno; la política ya existe y solo se reintenta el update. Si el entorno queda `Degraded` o `Severe`, consultar antes de actuar; si la causa es un parámetro ausente o inválido, se corrige y se repite el `apply`.

**Rotar un secreto** (paso aparte, posterior; los valores actuales se migran tal cual): sobrescribir el parámetro con el mismo método de arriba (`--overwrite`), reiniciar o redesplegar el entorno para que se relea (**por confirmar** si basta el reinicio) y comprobar el health check. Mientras no se rote, los valores antiguos siguen en versiones previas del estado de Terraform (bucket versionado) y en el `terraform.tfvars` local de quien desplegó.

**Vuelta atrás:** revertir exige revertir el commit completo (la `validation` nueva rechaza las tres claves, así que reponerlas como propiedades de entorno obliga a restaurar también `variables.tf` y a volver a poner los valores en `terraform.tfvars`). La política IAM y los parámetros no se borran solos; el humano los elimina aparte, con confirmación expresa.

## 3. Health check

- Beanstalk comprueba `HealthCheckPath = "/healthcheck"` **(corregido en rama `feature/testing` de infra; antes era `/`)**.
- El backend responde `200 ok` en `/healthcheck` (`app.js`, verificado). Resuelve infra:C6.
- Efecto confirmado tras el primer despliegue: **(por confirmar)**.

## 4. HTTPS, ALB y DNS

| Entorno | HTTPS | Balanceador | DNS |
|---|---|---|---|
| `dev` | Sí — CloudFront termina HTTPS delante de Beanstalk (`enable_cdn = true`) **(verificado)** | CloudFront → Beanstalk single (sin ALB); el origen solo admite el puerto 80 desde CloudFront (`infra:S17`, en código, pendiente del `apply`) | Ninguno (dominio de CloudFront) |
| `prod` | Sí, si `ssl_certificate_arn` está definido | ALB (autoescalado 1–3) | `backend.sigmetum-a.org` (CNAME al endpoint de Beanstalk, `modules/dns`) |

**(verificado en `environments/*/main.tf` y `modules/dns/main.tf`).**

En `prod`, con ALB y certificado, el listener 80 redirige con 301 a HTTPS (443) (`aws_lb_listener_rule.http_to_https`, `modules/beanstalk/main.tf`, verificado en código; efecto **(por confirmar)** tras el `apply` en prod). Afecta a todo cliente HTTP, no solo al navegador; en `dev` no cambia.

### Cabeceras `X-Forwarded-*` y `trust proxy`

El ALB de prod (y CloudFront en dev) añaden `X-Forwarded-For` y `X-Forwarded-Proto` a las peticiones, y **nginx** (el proxy de la plataforma de Beanstalk, `ProxyServer = nginx`) añade a su vez la dirección que le conecta, así que Express ve un salto más que el balanceador o la CDN. El backend configura `app.set('trust proxy', ...)` en `app.js` **(B1 resuelto, 03/10/2026)** con el número de saltos de `TRUST_PROXY_HOPS` (opcional; 1 si no se define; entero de 1 a 5, el 0 solo con `NODE_ENV` `local` o `test`, `config/trustProxy.js`, verificado): Express y el limitador de `express-rate-limit` leen la IP real del cliente. Infra fija ahora `TRUST_PROXY_HOPS = "2"` en las plantillas de `dev` (**medido en nginx, deducido en Express**) y de `prod` (**por confirmar**, no medido); el detalle, la tabla y el procedimiento están en la sección 6. `backend:I7` sigue abierto.

**El valor dos de `dev` solo es correcto para el tráfico que pasa por CloudFront.** Hasta el `apply` del paso de restricción del origen (`infra:S17`), una petición directa al CNAME de Beanstalk de `dev` llegaba por HTTP sin CloudFront (verificado el 31/10/2026 con `curl` y `describe-security-groups`): con dos saltos, Express toma como IP del cliente una entrada falsificable de `X-Forwarded-For`; con uno ocurre lo contrario. No hay un valor único correcto mientras el origen admita ambos caminos. La resolución en código (grupo de seguridad propio, puerto 80 solo desde la lista de prefijos gestionada de CloudFront) está pendiente del `apply` de `dev` y de su puerta de decisión: si tras el `apply` un `curl` directo sigue dando `200`, se revierte y se anota la deuda.

**Divergencia entre entornos:** `dev` restringe el origen a CloudFront y `prod` no (su instancia está detrás de un ALB con su propio grupo gestionado por Beanstalk; que no necesite este cambio es por confirmar). Consecuencias para el backend: en `dev` el CNAME directo de Beanstalk deja de servir y solo funciona la URL de CloudFront (no la uses en pruebas ni en configuración); en `dev` `TRUST_PROXY_HOPS = 2` pasa a ser correcto para todo el tráfico; `prod` no cambia. Límite residual: la lista de CloudFront admite cualquier distribución de CloudFront, no solo la nuestra; aun así CloudFront añade la IP real de quien se conecta al final de `X-Forwarded-For`.

## 5. Permisos IAM de S3

La política que `modules/storage` añade al rol `aws-elasticbeanstalk-ec2-role` tiene dos sentencias (`modules/storage/main.tf`, verificado en código; efecto aplicado **(por confirmar)** hasta el `apply`):

| Sentencia | Acciones | Recurso | Condición |
|---|---|---|---|
| `ObjectsInGalleryAndData` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | `gallery/*` y `data/*` del bucket del entorno | — |
| `ListGalleryAndData` | `s3:ListBucket` | El bucket | `StringLike` en `s3:prefix`: `gallery/*` o `data/*` |

Además, `modules/beanstalk` añade al mismo rol la política en línea `sigmetum-ssm-secrets-<env>`, con `ssm:GetParameters` y `ssm:GetParameter` solo sobre los tres parámetros de secretos del entorno (`/sigmetum/<env>/backend/<CLAVE>`), sin comodines y sin acceso a S3 (sección 2; **verificado en código, efecto aplicado por confirmar**). No cambia lo que el backend puede hacer en S3.

**Prefijos efectivos que debe respetar el backend:** `gallery/` y `data/` (esto cubre `data/active/`, `data/terms/`, `data/drafts/` y `data/<provincia>/`; `config/s3Paths.js`, verificado). **Sin acceso** para el rol a `assets/`, a la raíz del bucket ni a ningún otro prefijo: esos accesos darán acceso denegado. `assets/*` queda solo para CloudFront.

**Regla del listado:** todo `listObjectsV2` debe llevar `Prefix` con barra final dentro de `gallery/` o `data/`. Un listado sin `Prefix`, de la raíz o con `data` o `gallery` sin barra se deniega. Hoy solo hay un punto que lista, `listAllObjects` (`aws/awsS3connect.js`), y su `Prefix` siempre lleva barra final porque `listFilesInS3Folder` y `getPresignedUrlsFromS3Folder` lo normalizan (verificado). Llamadores:

| Llamador | Prefix enviado | Dentro de `gallery/` o `data/` |
|---|---|---|
| `getPresignedUrlsFromS3Folder` desde `routes/content.js:70` | `gallery/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:63` (`list-files`) | `data/` | Sí |
| `getMergedDataInS3Folder` desde `routes/data.js:93` | `data/active/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:44, 144, 200` | `data/<provincia>/` | Sí |
| `listFilesInS3Folder` desde `routes/data.js:53, 184` | `data/drafts/<provincia>/` | Sí |

Las URL prefirmadas se firman con el rol de instancias, así que la lectura de `gallery/` y `data/` sigue permitida. Usa las acciones `GetObjectCommand`, `PutObjectCommand` (vía `s3.putObject`), `DeleteObjectCommand` (vía `s3.deleteObject`) y `ListObjectsV2Command` (verificado); sin `PutObjectAcl` ni multipart.

**Un prefijo nuevo exige cambiar la política de infra antes** de que el backend lo use: si no, falla con acceso denegado.

**Nota 403 frente a 404 (por confirmar en dev):** S3 devuelve 404 `NoSuchKey` para una clave inexistente solo si quien llama tiene `s3:ListBucket` sin una condición que impida evaluarlo; `GetObject` no lleva `s3:prefix`, así que con el listado condicionado probablemente devuelva 403 `AccessDenied`. **Actualizado el 31/10/2026 (verificado en el código del backend):** `getTextJsonS3` (`aws/awsS3connect.js`) trata `AccessDenied` como lista vacía solo con la opción `vacioSiAccessDenied`, que usa `GET /list-terms`; `GET /get-data/:path(*)` valida la clave y responde 404 ante `AccessDenied`. Las rutas que escriben (`upload-term`, `delete-term`) **no** lo hacen, a propósito: un permiso roto no debe sobrescribir el glosario con `[]`. Consecuencia: si `data/terms/noLatinTerms.json` no existe, `/list-terms` da `200` con lista vacía, pero la primera alta de término (`upload-term`) responde 500. En `dev` el archivo no existe (verificado el 31/10/2026): hay que crearlo con `[]`.

**Tarea de infra.S15 (estado a 31/10/2026):** el backend ya trata `AccessDenied` en lecturas y valida la clave de `GET /get-data/:path(*)` (responde `400` `Invalid path` a rutas fuera de su lista de permitidos, verificado en `dev`). Falta crear `data/terms/noLatinTerms.json` con `[]` en `dev` y `prod` antes de la primera alta de término; no se debe tratar `AccessDenied` en las rutas de escritura. Prueba pendiente: dar de alta un término en `dev` con el archivo creado (por confirmar).

**Orden de despliegue:** el **backend se despliega ANTES del `apply` de infra**. Mitigación temporal si no puede ser: subir antes un `data/terms/noLatinTerms.json` con `[]` a dev y a prod, con el perfil de cada cuenta (marcadores, sin valores reales):

```bash
echo '[]' > noLatinTerms.json
aws s3 cp noLatinTerms.json s3://<bucket>/data/terms/noLatinTerms.json --profile <perfil-de-la-cuenta>
```

Esto ya no es solo una mitigación temporal: el archivo debe existir para que la primera alta de término funcione, porque el backend no trata `AccessDenied` en las rutas que escriben. `GET /get-data/<clave inexistente>` ya lo trata el backend. Ver [S7 y S15](../estado-y-deuda-tecnica.md).

**TLS y redirección:** el bucket deniega toda petición sin TLS (`aws:SecureTransport`); el SDK usa HTTPS por defecto, así que no cambia nada. En `prod`, tras el `apply`, el listener 80 del ALB redirige con 301 a HTTPS (443) para **todo** cliente HTTP; `app_env_vars` no cambia y el health check (grupo de destino, puerto 80 de la instancia) no pasa por el listener **(por confirmar)**.

## 6. Plataforma, tamaño de instancia y correo saliente

- **Plataforma:** `64bit Amazon Linux 2023 v6.11.9 running Node.js 22` (`modules/beanstalk/variables.tf`, verificado). El `package.json` del backend fija `engines.node` en `"22"` (B3, verificado), coherente con la plataforma.
- **Tamaño de instancia:** `t3.nano` en ambos entornos (verificado). El backend procesa ficheros Excel en memoria (`convertExcelToJson`, en `aws/awsS3connect.js` y otros); no hay una cifra de tamaño máximo de fichero ni una medición de uso de memoria con `t3.nano` (**por confirmar**; si los Excel crecen, puede haber que subir el tipo de instancia).
- **Correo saliente:** el backend usa `nodemailer` contra `smtp.gmail.com` (`routes/content.js`, verificado) con `EMAIL`/`EMAIL_PASSWORD`. Sale por el puerto SMTP habitual (587/465); el grupo de seguridad de salida de Beanstalk no está restringido en este repositorio (egress por defecto; el grupo propio de `dev` de `infra:S17` también deja la salida abierta a todo, justamente por el SMTP y S3), así que no debería bloquearlo (**por confirmar** en la cuenta real).
- **Despliegue:** GitHub Actions con OIDC (módulo `backend-ci-iam`). Push a `feature/testing` → dev; push a `master` → prod. Solo despliega si el job `verify` (lint, quality, docs:check, `npm test` y `npm audit --audit-level=high`) pasa. Ver sección 9.

### Medir los saltos de proxy (TRUST_PROXY_HOPS)

Solo marcadores: `<IP-visitante>`, `<IP-falsa>`, `<extremo-CloudFront>`, `<IP-ALB>`. Nunca se documentan direcciones reales, URL prefirmadas, ARN ni identificadores de cuenta o de grupo de seguridad.

**Regla de lectura:** con `trust proxy` = N, Express confía en los N últimos saltos empezando por el socket (nginx); `req.ip` es la entrada que queda a la izquierda de esos N saltos de confianza.

**Procedimiento** (en `dev` ya está hecho; en `prod` lo repite el humano con su perfil):

1. Peticiones marcadas a una ruta inocua, como `/healthcheck`, con User-Agent propio y sin `X-Forwarded-For`: `curl -sS -A "medicion-hops-<marca>" https://<url-backend>/healthcheck`; y otra igual con `-H "X-Forwarded-For: <IP-falsa>"`.
2. `aws elasticbeanstalk request-environment-info --environment-name <entorno> --info-type tail --profile <perfil>`, esperar unos segundos y `aws elasticbeanstalk retrieve-environment-info` con los mismos parámetros. **`request-environment-info` es un comando de AWS que escribe** (genera el paquete de logs en S3): no cuenta como solo lectura. Lo ejecuta quien tenga acceso al entorno y **permiso expreso**; en `prod` no se activa el registro de acceso del ALB.
3. `retrieve-environment-info` devuelve una URL prefirmada: descárgala, no la pegues en ningún documento ni chat (caduca al cabo de un rato). Abre la sección del registro de acceso de nginx y **borra el archivo descargado** al terminar.
4. Filtra las líneas con la marca (`grep "medicion-hops-<marca>"`) y, antes de compartir nada, sustituye las direcciones por los marcadores.
5. Lee `remote_addr` y `X-Forwarded-For` (última columna) y calcula N con la tabla.

**Tabla cadena a valor:**

| Entorno | Recorrido | `remote_addr` de nginx / `X-Forwarded-For` | Valor | Estado |
|---|---|---|---|---|
| `dev` | visitante, CloudFront, nginx, Express | `<extremo-CloudFront>` / `<IP-visitante>` (si el cliente falsifica la cabecera: `<IP-falsa>, <IP-visitante>`) | dos | **Medido** en lo que recibe nginx (31/10/2026); lo que recibe Express es **deducido** (nginx añade a su vecino: Express vería `[<IP-falsa>,] <IP-visitante>, <extremo-CloudFront>`; configuración de nginx de la instancia no leída, por confirmar) |
| `prod` | visitante, ALB, nginx, Express | `<IP-ALB>` / `<IP-visitante>` | dos | **Por confirmar**: no medido (no hay perfil de `prod` en la máquina de trabajo) |

Valores incorrectos en `dev` (deducido): uno hace que `req.ip` sea `<extremo-CloudFront>` (cupo compartido entre los visitantes de ese extremo); tres toma la entrada falsificable y el límite se esquiva. El valor por defecto del backend (uno) es, por tanto, incorrecto en `dev`.

**Si la cadena de `prod` cambia:** con CloudFront delante del ALB el valor sería tres (y habría que medirlo); un balanceador de red (NLB) no añade `X-Forwarded-For` (valdría uno); cada WAF o proxy adicional suma un salto. Hay que volver a medir ante cualquier cambio de la cadena.

**IPv6:** la versión instalada de `express-rate-limit` agrupa por defecto las direcciones IPv6 por subred (/56), así que el límite por IP no es por dirección exacta en IPv6 (el backend ya lo documenta en su `para-infra.md`; contrastado con la versión de su `package.json`, no probado con tráfico real).

**Verificación posterior al `apply` (por confirmar):** dos IP distintas deben agotar cada una su cupo sin afectar a la otra, en una ruta con límite y sin efectos secundarios. No existe una identificada: corresponde al backend indicarla. No sirven `/send-email` (envía correos) ni el login (gasta cupo y puede afectar a cuentas reales). Alternativa de apoyo, también por confirmar: leer la configuración de nginx de la instancia de `dev` en un paquete de logs para cerrar la deducción.

**Qué debe corregir el backend en su `para-infra.md`** (este repositorio no edita el suyo):

1. La contradicción entre «nginx (loopback) a Express» y «ALB, nginx, Express».
2. La frase «no se fija ningún valor por entorno».
3. Que el valor por defecto (uno) es incorrecto en `dev`.
4. Que este repositorio tiene solo dos entornos (`dev` y `prod`), aunque su documento habla de tres.

## 7. `ALLOWED_ORIGIN` por entorno

El backend acepta **una lista de orígenes separados por coma** en `ALLOWED_ORIGIN`. La función CORS en `app.js` divide el valor por `,`, elimina espacios, e invoca el callback con `true` si el origen del request está en la lista o si no hay origen (llamadas server-side). Si no coincide, rechaza con error (verificado).

```
ALLOWED_ORIGIN = "https://feature-testing.d37662kpg8985h.amplifyapp.com,https://main.d37662kpg8985h.amplifyapp.com"
```

| Entorno | Qué poner en `ALLOWED_ORIGIN` | Estado |
|---|---|---|
| `dev` | URL(s) de las ramas activas en Amplify, separadas por coma | Por fijar — añadir la URL de cada rama que necesite acceder al API |
| `prod` | Los dos orígenes del frontend, con el formato `https://<dominio>,https://www.<dominio>` (solo marcadores aquí; el dominio es el de la zona de `prod`, infra:C9). Sin barra final, y la comparación es exacta y sensible a mayúsculas (`includes` sobre cada origen tras `trim`; `validateEnv.js` solo exige que la variable exista, **verificado** en `app.js` y `config/validateEnv.js` del backend) | **Por fijar por una persona** en el `terraform.tfvars` de `prod` y aplicar el backend **antes** de que el frontend sirva desde el dominio nuevo |

**Dependencia de orden (infra:C9):** el dominio de `prod` lo crea `modules/amplify` en el `apply` de `prod`; el backend debe aceptar los dos orígenes antes, o el frontend recibiría 403 por CORS. El dominio por defecto de Amplify (`*.amplifyapp.com`) de `prod` no estará en la lista y el backend le dará 403 por CORS. Ver [para-frontend.md](para-frontend.md#4-orden-de-despliegue) (punto 5) para el orden completo. En `dev`, `ALLOWED_ORIGIN` sigue dependiendo de una URL que solo se conoce después de desplegar Amplify.

## 8. Discrepancias

| Id | Qué pasa | Dónde | Responsable | Qué hacer |
|---|---|---|---|---|
| **B1** | ~~Sin `trust proxy`, el límite de intentos de login puede agruparse por la IP del balanceador~~ | `../sigmetum-backend/app.js` | backend | **Resuelto (04/10/2026):** `trust proxy` añadido en commit `7748a1c`; hoy en `app.js`, con `TRUST_PROXY_HOPS` |
| **backend:I7** | `TRUST_PROXY_HOPS` en las plantillas `.example` (resuelto en el repositorio para `dev`, medido: dos); falta el `apply` del humano y medir `prod` | `modules/beanstalk/main.tf`, `environments/*/terraform.tfvars.example` | infra y backend | Humano: `apply` en `dev` y medición de `prod` (sección 6). Backend: indicar una ruta de verificación y corregir su `para-infra.md`. **Condición del backend:** es obligatorio **antes de desplegar la entrega 2 de M21** (`POST /send-email` pública); origen: `sigmetum-backend/docs/integracion/para-infra.md`, sección 6 (límite de `POST /send-email`) y fila I7 de la tabla de discrepancias. El backend no cambia código, pero no debe desplegar esa entrega hasta que infra lo confirme |
| **B2** | ~~La política IAM de S3 da escritura y borrado sobre todo el bucket~~ | `modules/storage/main.tf` | infra | **Resuelto en código (30/10/2026), dependiente de infra:S7:** la política se limita a `gallery/*` y `data/*` (sección 5). Efecto aplicado **(por confirmar)**; el backend debe tratar `AccessDenied` antes del `apply` (infra:S15) |
| **B3** | ~~`package.json` del backend no fija `engines.node`~~  | `../sigmetum-backend/package.json` | backend | **Resuelto (03/10/2026):** `"engines": { "node": "22" }` añadido |

## 9. CI: despliegue automático desde GitHub Actions

Push a `feature/testing` → despliega en `sigmetum-backend-dev-env`. Push a `master` → despliega en `sigmetum-backend-prod-env`. El deploy solo ocurre si el job `verify` (lint, quality, docs:check, `npm test` y `npm audit --audit-level=high`) pasa.

**Autenticación:** OIDC — sin claves de AWS en GitHub. El rol IAM `sigmetum-backend-ci-{env}` se crea con Terraform (`modules/backend-ci-iam/`) y su ARN aparece en el output `ci_role_arn` de cada entorno.

**Variables que hay que configurar en GitHub Actions del repo backend** (Settings → Variables):

| Variable | Valor (output de Terraform) |
|----------|-----------------------------|
| `AWS_ROLE_DEV` | output `ci_role_arn` del entorno dev |
| `AWS_ROLE_PROD` | output `ci_role_arn` del entorno prod |

El bucket de staging lo deriva el workflow del account ID al correr (`elasticbeanstalk-eu-west-3-{account_id}`) — no hace falta configurarlo.

**Puesta en marcha (paso a paso):**

1. Setear el profile de la cuenta dev y aplicar:
   ```powershell
   $env:AWS_PROFILE = "sigmetum-preprod"
   cd environments/dev
   terraform init
   terraform apply
   ```
2. Copiar el output `ci_role_arn` del apply (ARN del rol IAM).

3. En el repo `sigmetum-backend` → **Settings → Secrets and variables → Actions → Variables** → crear:

   | Variable | Valor |
   |----------|-------|
   | `AWS_ROLE_DEV` | ARN del output `ci_role_arn` (cuenta dev) |

4. Repetir los pasos 1–3 para prod (`sigmetum-prod`, entorno `environments/prod/`, variable `AWS_ROLE_PROD`).

5. Push a `feature/testing` → verificar en GitHub Actions que el job `deploy` pasa.
   - El job `deploy` **no corre en PRs**, solo en push directo a la rama.
   - Si falla por variables no configuradas: re-run desde la pestaña Actions tras crearlas.

## 10. Si cambias algo (en `sigmetum-infra`)

| Si cambias... | Actualiza en este documento | Avisa |
|---|---|---|
| Una clave de `app_env_vars` | Sección 2 | PR: qué clave, en qué entorno (solo nombres) |
| Uno de los tres secretos (`JWT_SECRET`, `EMAIL_PASSWORD`, `ADMIN_PASSWORD`) o su política IAM de lectura | Sección 2 (procedimiento de Parameter Store) y [referencia](../referencia-modulos.md#secretos-en-parameter-store) | PR: qué parámetro y en qué entorno (solo nombres); quién debe crearlo o rotarlo y en qué orden |
| `HealthCheckPath` u otro ajuste de Beanstalk | Sección 3 | PR |
| El ALB, el certificado o el DNS | Sección 4 | PR: nuevo dominio o URL |
| La política IAM de `modules/storage` | Sección 5 (y B2 de la sección 8) | PR: qué acciones o prefijos cambian |
| El listener 80 del ALB o la redirección a HTTPS | Secciones 4 y 5 | PR: efecto en clientes HTTP |
| El tipo de instancia | Sección 6 | PR: motivo (coste o capacidad) |
| `modules/backend-ci-iam` (rol, bucket, permisos) | Sección 9 | PR: qué cambió y si hay que actualizar variables en GitHub |

## 11. Mantener este documento

- Se actualiza cuando cambia `app_env_vars`, el health check, el ALB, el DNS o la política IAM de S3.
- Se contrasta con `config/validateEnv.js`, `config/trustProxy.js`, `app.js` y `aws/awsS3connect.js` del backend antes de afirmar algo sobre su código.
