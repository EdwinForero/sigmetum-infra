# TRUST_PROXY_HOPS (backend:I7): plan

Fecha: 2026-10-31 · Estado: cerrado · Spec: `docs/specs/2026-10-31-trust-proxy-hops-design.md`

Crítico: sí. Coincide la entrada «contrato con el frontend y el backend (VITE_*, build_spec, app_env_vars)» de `criticidad` (se añade una clave a `app_env_vars`); además, la cadena de proxies afecta a «red y TLS».

## Lo que se comprobó en el código

1. **`docs-check` compara solo conjuntos de claves** de `app_env_vars` de los dos `.example` contra la tabla `## app_env_vars` de la referencia (`scripts/docs-check.mjs`, bloque 6). Falla si falta o sobra alguna; no exige orden. La fila debe empezar por `` `TRUST_PROXY_HOPS` `` y llevar en la columna «Obligatoria» un texto que empiece por «No» (así el aviso contra `validateEnv.js` no salta).
2. **Cambia una sola cifra:** la de claves de `app_env_vars`, que pasa de diez a once. Solo vive en `docs/estado-y-deuda-tecnica.md` (tabla de métricas). En el resto de documentos y specs va con letras (`docs-check`, bloque 9).
3. **`quality-check` emitirá un AVISO, no un error:** el `.example` define `TRUST_PROXY_HOPS` y el backend no la exige (¿sobra?). Tocar el script queda fuera de alcance; va como hallazgo aparte. No hay regla de secretos que afecte al valor `"2"`.
4. **La `validation` de `modules/beanstalk` no se toca:** exige nueve claves y acepta extras. La nueva clave llega por el `dynamic "setting"` en `aws:elasticbeanstalk:application:environment`, así que será un setting nuevo en `aws_elastic_beanstalk_environment.this`.
5. **El backend acepta la forma `"2"`:** `config/trustProxy.js` valida con `/^[0-5]$/`; el 0 solo vale con `NODE_ENV` igual a `local` o `test`; sin definir, usa uno; no está en `required` de `validateEnv.js`, es opcional.
6. **Entornos:** `dev` = `load_balancer_type = "single"` y `enable_cdn = true` (CloudFront, nginx, Express); `prod` = `load_balancer_type = "application"` (ALB, nginx, Express; por confirmar).
7. **`docs-gate` exige el README:** el área `environments/**` obliga a tocar `docs/referencia-modulos.md` y `README.md`.

## Fase 1

1. **Clave en `dev`** (developer)
   - Archivo: `environments/dev/terraform.tfvars.example` (modificar). NUNCA leer `terraform.tfvars`.
   - Se añade una entrada al final del bloque `app_env_vars`, después de `EMAIL_PASSWORD`, con una línea en blanco antes (igual que las demás), dos líneas de comentario en español y la clave:
     ```
       # Saltos de proxy delante de Express (cadena entera de 1 a 5, sin espacios ni ceros a la izquierda).
       # Opcional en el backend (1 si no se define; en dev 1 es incorrecto). En dev se midió lo que recibe nginx; para Express es deducido: CloudFront, nginx, Express = 2.
       # Procedimiento y tabla: docs/integracion/para-backend.md (sección 6).
       TRUST_PROXY_HOPS = "2"
     ```
   - Comprobación: `git diff` solo muestra líneas añadidas al final del bloque; `terraform fmt -check -recursive`; `terraform init -backend=false && terraform validate` en `environments/dev`; `node scripts/quality-check.mjs` pasa con el AVISO esperado; `node scripts/docs-check.mjs` solo pasa cuando estén hechos el paso 3 (referencia) y la métrica del paso 4.
   - Norma: `buenas-practicas-terraform.md`, `seguridad.md` (solo marcadores), `para-backend.md` sección 2.

2. **Clave en `prod`** (developer)
   - Archivo: `environments/prod/terraform.tfvars.example` (modificar). Misma posición, después de `EMAIL_PASSWORD`:
     ```
       # Saltos de proxy delante de Express (cadena entera de 1 a 5, sin espacios ni ceros a la izquierda).
       # Opcional en el backend (1 si no se define). Mismo valor que dev, POR CONFIRMAR: recorrido esperado ALB, nginx, Express; prod no está medido.
       # Procedimiento de medición: docs/integracion/para-backend.md (sección 6).
       TRUST_PROXY_HOPS = "2"
     ```
   - Comprobación: `git diff` muestra solo la clave y sus comentarios; `terraform init -backend=false && terraform validate` en `environments/prod`; `terraform fmt -check -recursive`.

## A cargo del tester-documentador

3. **`docs/referencia-modulos.md`:** añadir a la tabla `## app_env_vars`, tras `EMAIL_PASSWORD`, la fila `` `TRUST_PROXY_HOPS` | No | Saltos de proxy de confianza del backend: cadena entera de 1 a 5, sin espacios ni ceros a la izquierda (el 0 solo con NODE_ENV local o test); 1 si no se define. `dev` y `prod` llevan el mismo valor; el de `prod` está por confirmar (ver [para-backend.md](../integracion/para-backend.md#6-plataforma-tamaño-de-instancia-y-correo-saliente)) ``. En el párrafo introductorio, aclarar que hay nueve obligatorias y que las demás son opcionales, sin «número + claves». Ajustar el anchor del enlace a la cabecera real de la sección 6. No repetir cifras ni valores secretos.

4. **`docs/estado-y-deuda-tecnica.md`:**
   - Métricas: la fila de claves de `app_env_vars` pasa de diez a once (confirmar con `node scripts/docs-check.mjs --metrics`). «Última actualización» con la fecha de hoy, 31/10/2026.
   - **backend:I7: mantener la fila en «Abiertos» y reescribirla.** Prod sigue por medir y el `apply` de dev lo hace el humano; el backend la exige antes de M21 (entrega 2). Texto: «Resuelto en el repositorio para dev (medido: valor dos); pendiente: `apply` del humano y medición en prod (valor esperado dos, por confirmar)». Prioridad alta. Registrar que el valor por defecto (uno) es incorrecto en dev: `req.ip` es hoy el extremo de CloudFront y todos los visitantes de ese extremo comparten el cupo. Añadir la verificación posterior al `apply` (por confirmar; falta una ruta con límite y sin efectos, que corresponde indicar al backend; no sirven `/send-email` ni el login). Mover a Resueltos solo cuando se mida prod y se aplique en ambos entornos.
   - Fila C12 de Resueltos: «Fijar la variable sigue abierto: `backend:I7`» pasa a «resuelto en repo para dev».
   - **Nota sobre M2:** «M2 en revisión (31/10/2026). La web de dev sirve el build de desarrollo de React: el bundle contiene `react-dom.development` y el aviso de DevTools. Causa probable, por confirmar: `NODE_ENV=dev` en Amplify. Contradice el cierre “no afecta” de M2 de esta misma tarde. Se tratará en un ciclo propio.» Aquí solo la nota; no se corrige el texto de cierre de M2.
   - Cifras volátiles con letras salvo la tabla de métricas.

5. **`docs/integracion/para-backend.md`:**
   - Cabecera: fecha 31/10/2026 y `TRUST_PROXY_HOPS`; commit base si procede.
   - Sección 1: fila `backend:I7`: «Resuelto en el repositorio para dev (medido: dos). Pendiente: `apply` del humano, medición en prod»; mantener la condición «antes de M21, entrega 2».
   - Sección 2: la fila `TRUST_PROXY_HOPS` pasa a «Sí (`"2"` en los `.example`)»; nota del efecto operativo: añadir la clave cambia las propiedades de entorno de Beanstalk, reconfigura el entorno y puede reiniciar la app; el `apply` lo ejecuta el humano; el backend ya soporta la variable (M12), sin despliegue previo en backend ni frontend.
   - Sección 4 («Cabeceras `X-Forwarded-*` y `trust proxy`»): reescribir con la cadena real, que incluye nginx; sustituir «Infra no fija hoy la variable…» por el valor medido.
   - **Sección 6: subsección nueva «Medir los saltos de proxy (TRUST_PROXY_HOPS)»**, solo con marcadores:
     - Regla de lectura: `trust proxy` = N confía en los N últimos saltos empezando por el socket (nginx); `req.ip` es la entrada que queda a la izquierda de los N saltos de confianza.
     - Procedimiento (dev: ya hecho; prod: lo repite el humano con su perfil): (a) peticiones marcadas a una ruta inocua, p. ej. `/healthcheck`, con User-Agent propio y sin `X-Forwarded-For`: `curl -sS -A "medicion-hops-<marca>" https://<url-backend>/healthcheck`, y otra con `-H "X-Forwarded-For: <IP-falsa>"`; (b) `aws elasticbeanstalk request-environment-info --environment-name <entorno> --info-type tail --profile <perfil>`, esperar unos segundos y `retrieve-environment-info` con los mismos parámetros; (c) `retrieve` devuelve una URL prefirmada: descargarla, no pegarla en ningún documento ni chat; abrir la sección del registro de acceso de nginx; (d) filtrar las líneas con la marca (`grep "medicion-hops-<marca>"`) y, antes de compartir nada, sustituir las direcciones por marcadores `<IP-visitante>`, `<IP-falsa>`, `<extremo-CloudFront>` y `<IP-ALB>`; (e) leer `remote_addr` y `X-Forwarded-For` (última columna) y calcular N con la tabla.
     - En prod no se activa el registro de acceso del ALB; lo ejecuta quien tenga acceso a prod, y solo con su permiso expreso.
     - Tabla cadena a valor: `dev`: visitante, CloudFront, nginx, Express; `remote_addr` de nginx = `<extremo-CloudFront>` y `X-Forwarded-For` = `<IP-visitante>` (con `<IP-falsa>` a la izquierda si el cliente la falsifica); valor dos; **medido** en nginx, lo que recibe Express **deducido** (nginx añade su vecino; por confirmar). `prod`: visitante, ALB, nginx, Express; `<IP-ALB>` / `<IP-visitante>`; valor dos; **por confirmar** (no medido). Valores incorrectos en dev (deducido): uno hace que `req.ip` sea `<extremo-CloudFront>` (cupo compartido); tres toma la entrada falsificable y el límite se esquiva.
     - Verificación posterior al `apply` (por confirmar): dos IP distintas deben agotar cada una su cupo sin afectar a la otra, en una ruta con límite y sin efectos; no existe una identificada, corresponde al backend indicarla; no usar `/send-email` ni login.
     - Qué debe corregir el backend en su `para-infra.md` (cuatro puntos, sin editar su repo): (i) la contradicción entre «nginx (loopback) a Express» y «ALB, nginx, Express»; (ii) la frase «no se fija ningún valor por entorno»; (iii) que el valor por defecto (uno) es incorrecto en dev; (iv) que este repositorio tiene solo dos entornos (`dev` y `prod`), aunque su documento habla de tres.
   - Sección 8: fila `backend:I7` con el mismo estado que la sección 1. Sección 10: sin cambios.

6. **`README.md`:** lo exige `docs-gate` para `environments/**`. En las secciones Dev y Prod, una frase breve en inglés: `TRUST_PROXY_HOPS` es una clave opcional de `app_env_vars` y su valor de prod está por confirmar. Fila en la tabla de documentos con la spec, el plan y el aviso de PR de este ciclo. Sin «número + claves».

7. **Aviso de PR** (`docs/specs/2026-10-31-trust-proxy-hops-aviso-pr.md`; sección «Frontend y backend» de `.github/pull_request_template.md`):
   - **Frontend:** sin cambios (no toca `VITE_*`, `build_spec`, dominios ni bucket). Hallazgo lateral aparte: ciclo propio sobre `NODE_ENV` en Amplify (M2).
   - **Backend:** sin despliegue previo, el backend ya soporta la variable.
   - **Orden:** (1) el humano añade `TRUST_PROXY_HOPS = "2"` a su `environments/dev/terraform.tfvars` (nombre de la clave, nunca su contenido); (2) `plan` y lo revisa; (3) `apply`; (4) después mide prod con el procedimiento de la sección 6 y añade la clave a su `terraform.tfvars` de prod.
   - **Efecto:** el `apply` reconfigura el entorno y puede reiniciar la app.
   - **Qué mirar en el `plan` (sin pegar su salida):** solo el cambio en sitio de `aws_elastic_beanstalk_environment.this`, con un setting nuevo en `aws:elasticbeanstalk:application:environment`; nada más, sin destroy ni replace. Cualquier otro cambio o reemplazo: parar y avisar.
   - Backend: corregir su `para-infra.md` (los cuatro puntos del paso 5). El valor de prod sigue por confirmar: medirlo antes del `apply` de prod.

## Pruebas

- Sin pruebas nuevas ni modificadas (los `.example` y los documentos no tienen base de tests).
- Verificación, en este orden: `terraform fmt -check -recursive`; `terraform init -backend=false && terraform validate` en `environments/dev` y `environments/prod`; `node scripts/quality-check.mjs` (con el AVISO esperado); `node scripts/docs-check.mjs`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs` (lo ejecuta el orquestador). No hace falta `node --test` (`plugins/` no se toca). Ningún rol ejecuta `plan`, `apply` ni comandos de AWS.

## Hallazgos fuera de la spec

1. **AVISO de `quality-check`:** seguirá diciendo que el `.example` define `TRUST_PROXY_HOPS` y el backend no la exige; es opcional y la lista blanca del script solo conoce `PORT`. Anótalo como deuda menor en el estado; no se corrige aquí (tocar scripts queda fuera de alcance).
2. **Sección 4 de `para-backend.md`:** dice que el ALB de prod y CloudFront en dev añaden `X-Forwarded-*`; hay que añadir que nginx añade su vecino, por lo que Express ve un salto más (incluido en el paso 5).
3. **Verificación posterior al `apply`:** sigue por confirmar mientras el backend no indique una ruta con límite y sin efectos secundarios.
4. **Valor «dos» en prod sin medir:** el `.example` lo lleva con comentario «por confirmar»; si el humano copia el `.example` tal cual a su `terraform.tfvars` de prod sin medir, fija un valor no verificado (si fuera tres o más, se esquivaría el límite falsificando `X-Forwarded-For`). El aviso de PR debe pedir que se mida antes del `apply` de prod.

## Cambios incorporados tras la segunda opinión sobre el plan (31/10/2026)

El revisor independiente y una comprobación del orquestador (solo lectura) añaden estos puntos; el tester-documentador los incorpora en los pasos 4, 5 y 7, y el developer en el comentario del paso 1 (ya ajustado arriba):

1. **Origen de dev abierto (hallazgo nuevo, importante).** Verificado el 31/10/2026: una petición HTTP directa al CNAME del entorno de Beanstalk de dev, sin pasar por CloudFront, devuelve `200` en `/healthcheck` y en una ruta pública, y el grupo de seguridad del entorno admite el puerto 80 desde cualquier origen (lectura con `describe-security-groups`; `modules/beanstalk/main.tf` no restringe el origen a CloudFront). Consecuencia con dos saltos de confianza: el valor dos es correcto solo para el tráfico que pasa por CloudFront; en una petición directa, Express toma como IP del cliente una entrada falsificable de `X-Forwarded-For`, así que el límite de login y de `/send-email` se podría esquivar llamando al origen directamente. Con el valor uno ocurre lo contrario (por CloudFront se comparte el cupo del extremo; en directo es correcto). **No existe un valor único correcto mientras el origen admita ambos caminos.** Solución de fondo (deuda nueva, fuera de este ciclo): restringir el origen a CloudFront (lista de prefijos gestionada de CloudFront en el grupo de seguridad, o una cabecera secreta que compruebe nginx). Registrar como **S17** (media-alta) en el estado, y que `backend:I7` NO pase a resuelto por el valor dos: queda «valor medido y fijado en el ejemplo de dev; riesgo residual por S17».
2. **Cambio de la cadena en prod:** si hubiera CloudFront delante del ALB, el valor sería tres (y habría que medirlo); un balanceador de red (NLB) no añade `X-Forwarded-For` (valdría uno); cada WAF o proxy adicional suma un salto. Incluirlo en la subsección de la sección 6 del paso 5.
3. **`request-environment-info` es un comando de AWS que escribe** (genera el paquete de logs en S3): lo reserva el procedimiento a quien tenga acceso y permiso expreso, y hay que decirlo explícitamente en el procedimiento (no cuenta como solo lectura). Añadir al procedimiento: borrar el archivo descargado y recordar que la URL prefirmada caduca.
4. **IPv6 y express-rate-limit:** la versión instalada agrupa por defecto las direcciones IPv6 por subred (/56); el límite por IP no es por dirección exacta en IPv6. Nota en la sección 6 (contrastar con la versión del backend; el backend ya lo documenta en su `para-infra.md`).
5. **Verificación al margen:** el aviso `quality-check` «¿sobra?» seguirá apareciendo hasta que el script conozca `TRUST_PROXY_HOPS` (hallazgo 1 de arriba).

## Fase 2: restringir el origen de dev a CloudFront (paso 8; decisión 4 de la spec)

El architect no tuvo acceso a documentación en línea en este rol: todo lo del comportamiento real de AWS va como (por confirmar). **Crítico: sí** (red y TLS de dev; el orquestador lo clasifica así: toca grupos de seguridad y reemplaza la instancia).

### Resolución de las cuestiones

1. **Vía: grupo de seguridad propio con la lista de prefijos gestionada de CloudFront.** Se descarta la cabecera secreta: la comprobación tendría que vivir en nginx y su configuración va en el paquete del backend (`.platform/`), que Terraform no puede inyectar con `aws:elasticbeanstalk:*` (fuera de alcance). Límite residual: la lista admite cualquier distribución de CloudFront, no solo la nuestra; aun así, el cliente real sigue siendo el que se conecta a CloudFront, que añade la IP real al final de `X-Forwarded-For`.
2. **Incógnita clave (por confirmar):** si, al definir `SecurityGroups` en una instancia única, Beanstalk deja de adjuntar su grupo por defecto (puerto 80 abierto a todos) o se suman. Mi recuerdo es que los SG propios lo sustituyen en instancias, pero no está asegurado para entornos de instancia única. Si se sumaran, la vía no cierra el puerto y no hay solución solo con Terraform (quitar la regla del grupo por defecto exige gestionarlo con `terraform import`, prohibido sin confirmación expresa, y el grupo pertenece a la pila de CloudFormation de Beanstalk). **Puerta de decisión:** se aplica en dev y se prueba con `curl` directo; si sigue respondiendo `200`, se revierte (quitar el setting y los recursos) y se anota la deuda.
3. **Impacto (por confirmar):** cambiar `SecurityGroups` modifica la plantilla de lanzamiento y la instancia se reemplaza en la actualización; en `AllAtOnce` y con una sola instancia el backend de dev queda caído unos minutos. Terraform lo ve como actualización en el sitio de `aws_elastic_beanstalk_environment.this`, no como reemplazo; el CNAME no cambia, así que CloudFront y Amplify siguen apuntando bien. La lista de prefijos tiene unas cincuenta y cinco entradas y cuenta como tantas reglas en el grupo; la cuota por defecto es sesenta reglas de entrada por grupo (cabe, con poco margen); si el `apply` falla con `RulesPerSecurityGroupLimitExceeded`, hay que pedir un aumento de cuota en Service Quotas (la cifra se puede mirar sin escribir con `aws ec2 describe-managed-prefix-lists`). Con grupo propio, `SSHSourceRestriction` deja de aplicarse (por confirmar): el paso incluye una regla de acceso remoto condicionada por la misma condición que hoy (en dev está desactivado: `ssh_key_name` vacío, no se crea). Un `aws_security_group` sin reglas inline pierde la salida abierta por defecto: hace falta salida a todo (no basta 80/443: el backend envía correo por SMTP en otros puertos); es la misma apertura que ya tenía el grupo de Beanstalk, y queda justificada. El healthcheck con `SystemType = basic` en instancia única va local (por confirmar). Los despliegues de GitHub Actions usan `UpdateEnvironment` y la instancia descarga de S3 por la salida: no necesitan entrada; el workflow del backend no hace `curl` al CNAME.
4. **Prod no cambia:** el ALB tiene su propio grupo gestionado por Beanstalk, y la condición hace que el recuento sea cero en prod (que el ALB no necesite este cambio es por confirmar).
5. **`TRUST_PROXY_HOPS` y `backend:I7`:** el valor dos no cambia; con el origen restringido, el dos pasa a ser correcto para todo el tráfico de dev. `backend:I7` no se cierra todavía (faltan la medición de prod y la verificación posterior al `apply`); se actualiza la redacción, no el estado. S17 se registra como «resuelto en código para dev, pendiente del `apply` y de la puerta de decisión».

### Paso 8 (developer): `modules/beanstalk/main.tf`

Sin variables ni outputs nuevos. Añadir a `locals`:

```hcl
  restrict_origin = var.enable_cdn && var.load_balancer_type == "single"
```

Tras el bloque de `IamInstanceProfile`, un setting dinámico:

```hcl
  # Origin SG: port 80 only from CloudFront (dev single instance)
  dynamic "setting" {
    for_each = local.restrict_origin ? [aws_security_group.origin[0].id] : []
    content {
      namespace = "aws:autoscaling:launchconfiguration"
      name      = "SecurityGroups"
      value     = setting.value
    }
  }
```

Tras el cierre del recurso `aws_elastic_beanstalk_environment`:

```hcl
# ── Origin restriction (dev only): port 80 reachable only from CloudFront ─────
data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = local.restrict_origin ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "origin" {
  count       = local.restrict_origin ? 1 : 0
  name_prefix = "sigmetum-backend-${var.environment}-origin-"
  description = "Beanstalk instance: HTTP only from CloudFront"
  vpc_id      = var.vpc_id

  tags = {
    Component = "backend"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "origin_http_cloudfront" {
  count             = local.restrict_origin ? 1 : 0
  security_group_id = aws_security_group.origin[0].id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront[0].id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP from CloudFront origin-facing prefix list"
}

# Beanstalk ignores SSHSourceRestriction when SecurityGroups is set (por confirmar)
resource "aws_vpc_security_group_ingress_rule" "origin_remote_access" {
  for_each          = local.restrict_origin && var.ssh_key_name != "" ? toset(var.ssh_allowed_cidrs) : toset([])
  security_group_id = aws_security_group.origin[0].id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  description       = "Remote access from explicit CIDRs"
}

resource "aws_vpc_security_group_egress_rule" "origin_all" {
  count             = local.restrict_origin ? 1 : 0
  security_group_id = aws_security_group.origin[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound: S3, Beanstalk endpoints, SMTP"
}
```

- Reglas de `quality-check` que el HCL respeta: el recurso con `0.0.0.0/0` es solo el de salida, cuyo cuerpo no contiene `22` ni `ssh` y no declara `from_port`/`to_port`; no poner esas palabras en comentarios dentro de ese bloque; la regla de acceso remoto usa CIDR variables, sin `0.0.0.0/0`, y su nombre evita la palabra `ssh` por prudencia; `aws_security_group` no está en `TAGGABLE` (lleva `Component` por coherencia; el resto de etiquetas vienen de `default_tags`); `aws_vpc_security_group_*_rule` existe en el proveedor `~> 5.0` (por confirmar con `terraform validate`); sin `provisioner` ni `null_resource`.
- Comprobación del developer: `terraform fmt -check -recursive`; `terraform init -backend=false` y `terraform validate` en `dev` y `prod`; `git diff` de `environments/` solo con los dos `.example`; Grep de `http://` y de doce dígitos en los `.tf` tocados.

### A cargo del tester-documentador (adición de la Fase 2)

1. `docs/estado-y-deuda-tecnica.md`: la cifra de recursos declarados sube en cuatro recursos del módulo (grupo, regla de entrada HTTP, regla de entrada de acceso remoto y regla de salida); confirmarla con `node scripts/docs-check.mjs --metrics`; registrar **S17** (origen de dev abierto: «resuelto en código para dev, pendiente del `apply` y de la puerta de decisión»; si la prueba de la puerta de decisión falla, anotar la deuda con el límite del `import`).
2. `docs/referencia-modulos.md`, módulo beanstalk: describir los recursos nuevos, que solo existen con `enable_cdn` y `load_balancer_type = "single"`; sin variables ni outputs nuevos.
3. `docs/guias/seguridad.md` (línea de «los grupos de seguridad los gestiona Beanstalk»): ya no es cierta en dev; añadir que dev tiene un grupo propio con HTTP solo desde CloudFront y la salida abierta justificada (SMTP, S3).
4. `README.md` (tabla de recursos y secciones Dev y Prod) y `docs/integracion/para-backend.md`: dev restringe el origen y prod no (explicar la divergencia entre entornos, exigida por `CLAUDE.md`); en dev el CNAME directo de Beanstalk deja de servir y solo funciona la URL de CloudFront; en dev `TRUST_PROXY_HOPS = 2` es correcto para todo el tráfico; prod sin cambios (por confirmar).
5. Aviso de PR: frontend sin acciones (la URL de CloudFront no cambia); backend: no usar el CNAME directo en dev; `backend:I7` sigue abierto. Orden: aplicar primero los pasos 1 a 7 y después el 8, en `apply` separados (si falla, se atribuye; un solo `apply` ahorra un corte en dev).

### Qué mira el humano en el `plan` de dev (no pegar la salida)

1. Altas como máximo: el grupo `aws_security_group.origin[0]`, la regla de entrada HTTP, la regla de salida y las de acceso remoto (cero si SSH está desactivado), más la lectura del `data` de la lista de prefijos.
2. Un cambio en el sitio de `aws_elastic_beanstalk_environment.this`, con un setting nuevo `SecurityGroups` (valor «known after apply»); el bloque de settings puede mostrarse entero; revisar que no cambie nada más.
3. Cero destroy o replace de entorno, aplicación o CloudFront. Aun así la instancia EC2 se reemplaza por dentro: dev queda caído unos minutos.
4. El `plan` de prod no debe mostrar ningún recurso nuevo.

### Criterio de aceptación tras el `apply` de dev

1. `curl` directo al CNAME de Beanstalk (puerto 80) deja de devolver `200` (tiempo de espera o rechazo). Si sigue en `200`, se activa la puerta de decisión: revertir y anotar la deuda.
2. `curl https://<dominio de CloudFront>/healthcheck` sigue en `200`.
3. El entorno vuelve a Green (unos minutos en Grey o Yellow tras reemplazar la instancia; por confirmar), con `describe-environment-health` de solo lectura.
4. Un despliegue de GitHub Actions posterior termina bien (por confirmar).

El humano debe aceptar explícitamente tres cosas: el corte de dev, la puerta de decisión y la salida abierta a todo.

## Cierre

- Documentos de integración afectados: `docs/integracion/para-backend.md` (secciones 1, 2, 4, 6 y 8). `para-frontend.md` no se ve afectado en este ciclo.
- Segunda opinión: se pide sobre este plan y sobre el diff.
