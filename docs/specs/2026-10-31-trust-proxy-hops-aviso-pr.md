# Aviso para PR: TRUST_PROXY_HOPS (backend:I7) y restricción del origen de dev (S17)

Fecha: 31/10/2026 · Cambio **crítico** (`app_env_vars`, contrato con el backend; red y TLS de `dev`; reemplazo de la instancia de `dev` por dentro) · Spec: [design](2026-10-31-trust-proxy-hops-design.md) · Plan: [plan](2026-10-31-trust-proxy-hops-plan.md)

## Qué cambia

- **Clave opcional `TRUST_PROXY_HOPS` en `app_env_vars`** de las dos plantillas `.example`, con el valor dos. En `dev` está **medido** lo que recibe nginx (`remote_addr` = `<extremo-CloudFront>`; `X-Forwarded-For` con `<IP-visitante>`, o `<IP-falsa>, <IP-visitante>` si el cliente falsifica) y **deducido** lo que recibe Express. En `prod` el valor está **por confirmar** (recorrido esperado: visitante, ALB, nginx, Express; `<IP-ALB>`): no se ha medido.
- **El valor por defecto del backend (uno) es incorrecto en `dev`**: `req.ip` sería `<extremo-CloudFront>` y todos los visitantes de ese extremo compartirían cupo.
- **S17 (nuevo): origen de `dev` abierto.** Verificado el 31/10/2026 con `curl` y `describe-security-groups`: el CNAME de Beanstalk de `dev` respondía por HTTP directo, sin CloudFront, y su grupo de seguridad admitía el puerto 80 desde cualquier origen. Con dos saltos, esa vía permite falsificar `X-Forwarded-For` y esquivar los límites de login y `/send-email`. `modules/beanstalk/main.tf` crea ahora, solo en `dev` (`enable_cdn` y `load_balancer_type = "single"`), un grupo de seguridad propio con el puerto 80 solo desde la lista de prefijos gestionada de CloudFront, la regla de acceso remoto (cero en `dev`: `ssh_key_name` vacío) y la salida abierta a todo (SMTP y S3), y lo pasa con `SecurityGroups`. Sin variables ni outputs nuevos; `prod` no cambia.
- **Divergencia dev/prod, explicada en el README:** `dev` restringe el origen y `prod` no (su ALB tiene un grupo gestionado por Beanstalk; que no necesite el cambio es por confirmar).
- **M2 reabierto** (nota en el estado, ciclo propio): la web de `dev` sirve el build de desarrollo de React; causa probable `NODE_ENV=dev` en Amplify (por confirmar). No se toca aquí.
- **Deuda menor M13:** `quality-check` seguirá avisando «¿sobra?» por `TRUST_PROXY_HOPS` (la clave es opcional y el script solo conoce `PORT`). Es un aviso esperado, no un error.

## Orden de despliegue

1. **Backend y frontend: sin acciones previas.** El backend ya soporta la variable (M12); la URL de CloudFront de `dev` no cambia.
2. El humano añade `TRUST_PROXY_HOPS = "2"` a su `environments/dev/terraform.tfvars` (solo el nombre de la clave aquí; nunca su contenido).
3. `plan` y revisión (ver abajo), y `apply` de la clave y de los demás cambios que no sean el origen (pasos 1 y 2 del plan).
4. **Después, en otro `apply`**, el paso 8 (restricción del origen). Separarlos permite atribuir un fallo a cada cambio.
5. Probar el criterio de aceptación (ver abajo).
6. `prod`: medir antes con el procedimiento de [para-backend.md](../integracion/para-backend.md#medir-los-saltos-de-proxy-trust_proxy_hops) y solo entonces añadir la clave a su `terraform.tfvars` de `prod`. Si se copia el `.example` sin medir, se fija un valor no verificado (con tres o más saltos reales, se esquivaría el límite falsificando `X-Forwarded-For`).

## Efectos operativos

- Añadir la clave cambia las propiedades de entorno de Beanstalk: **reconfigura el entorno y puede reiniciar la app**.
- El `apply` del origen cambia `SecurityGroups`: modifica la plantilla de lanzamiento y la **instancia de `dev` se reemplaza; el backend de `dev` queda caído unos minutos** (por confirmar). El CNAME no cambia.
- La lista de prefijos de CloudFront cuenta como una regla por entrada en el grupo; la cuota por defecto puede quedarse justa **(por confirmar)**. Si el `apply` falla con `RulesPerSecurityGroupLimitExceeded`, pedir un aumento en Service Quotas (la cifra se mira sin escribir con `aws ec2 describe-managed-prefix-lists`).
- Con grupo propio, `SSHSourceRestriction` deja de aplicarse (por confirmar); en `dev` el acceso remoto está desactivado.

## Qué mira el humano en el `plan` de `dev` (no pegar la salida)

1. **Primer `apply` (clave):** solo un cambio en el sitio de `aws_elastic_beanstalk_environment.this`, con un setting nuevo en `aws:elasticbeanstalk:application:environment`; sin destroy ni replace. Cualquier otro cambio: parar y avisar.
2. **Segundo `apply` (origen):** altas como máximo del grupo `aws_security_group.origin[0]`, la regla de entrada HTTP, la regla de salida y las de acceso remoto (cero), más la lectura del `data` de la lista de prefijos; un cambio en el sitio de `aws_elastic_beanstalk_environment.this` con el setting nuevo `SecurityGroups` (valor «known after apply»); cero destroy o replace de entorno, aplicación o CloudFront.
3. **El `plan` de `prod` no debe mostrar ningún recurso nuevo.**

## Criterio de aceptación tras el `apply` de `dev`

1. `curl` directo al CNAME de Beanstalk (puerto 80) deja de devolver `200` (tiempo de espera o rechazo).
2. `curl https://<dominio-de-CloudFront>/healthcheck` sigue en `200`.
3. El entorno vuelve a Green (unos minutos en Grey o Yellow tras el reemplazo; por confirmar), con `describe-environment-health` de solo lectura.
4. Un despliegue posterior de GitHub Actions termina bien (por confirmar).
5. Verificación del cupo (por confirmar): dos IP distintas agotan cada una su cupo sin afectar a la otra, en una ruta con límite y sin efectos; el backend aún no ha indicado ninguna (no sirven `/send-email` ni el login).

**Puerta de decisión:** si el punto 1 sigue dando `200` (por ejemplo, porque Beanstalk suma el grupo propio al suyo por defecto), se **revierte** (quitar el setting y los recursos del paso 8) y se anota la deuda: cerrar la regla del grupo por defecto exigiría `terraform import`, prohibido sin confirmación expresa. El humano debe aceptar de forma explícita tres cosas: el corte de `dev`, la puerta de decisión y la salida abierta a todo.

## Frontend y backend

- **Frontend: sin acciones.** No toca `VITE_*`, `build_spec`, dominios ni bucket, y la URL de CloudFront no cambia. Hallazgo lateral, aparte: ciclo propio sobre `NODE_ENV` en Amplify (M2).
- **Backend:** sin despliegue previo. En `dev`, **no usar el CNAME directo de Beanstalk** (tras el `apply` deja de servir; solo funciona la URL de CloudFront). Corregir su `para-infra.md`: (i) la contradicción entre «nginx (loopback) a Express» y «ALB, nginx, Express»; (ii) la frase «no se fija ningún valor por entorno»; (iii) que el valor por defecto (uno) es incorrecto en `dev`; (iv) que este repositorio tiene solo dos entornos (`dev` y `prod`). Indicar una ruta con límite y sin efectos para la verificación del cupo. `backend:I7` sigue abierto (medición de `prod`, `apply` y riesgo residual por S17) y debe cerrarse antes de la entrega 2 de M21.
- **Orden de despliegue:** `dev` (clave, después origen), medición de `prod`, `prod`.

## Documentos de integración

`docs/integracion/para-backend.md` (secciones 1, 2, 4, 6 y 8) puesto al día: nueva subsección «Medir los saltos de proxy (TRUST_PROXY_HOPS)» con el procedimiento (`request-environment-info` es un comando de AWS que **escribe**: lo ejecuta quien tenga acceso y permiso expreso; borrar el archivo descargado; la URL prefirmada caduca), la tabla cadena a valor y los cuatro puntos para el backend. `para-frontend.md` no cambia.

## Por confirmar

- Lo que recibe Express en `dev` (deducido; configuración de nginx no leída en la instancia) y todo `prod` (no medido).
- Si Beanstalk sustituye su grupo por defecto o suma el nuestro (puerta de decisión), la cuota de reglas, el corte de `dev`, la salud del entorno y el despliegue posterior de GitHub Actions.
- Pendiente de decisión del responsable de las guías: `docs/guias/seguridad.md` (SEG-7, «los grupos de seguridad los gestiona Beanstalk» y su estado) ya no es cierto en `dev`; este rol no edita las guías, así que debe actualizarlo quien las mantiene (propuesta: indicar que `dev` tiene un grupo propio con HTTP solo desde CloudFront y la salida abierta justificada por el SMTP y S3).
