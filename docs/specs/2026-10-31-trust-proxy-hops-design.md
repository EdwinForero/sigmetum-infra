# TRUST_PROXY_HOPS: medir los saltos de proxy y fijarlos (backend:I7): spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

El backend fija `trust proxy` con `TRUST_PROXY_HOPS` (entero de uno a cinco, uno por defecto) y de ese valor depende `req.ip`, que alimenta los límites de intentos de login y de `POST /send-email` (esta última ya pública). Hoy la variable no está en `app_env_vars`. Con un valor mayor que el real se esquiva el límite falsificando `X-Forwarded-For`; con uno menor todos los visitantes de un mismo proxy comparten cupo. La medición de dev (ver «Medición») muestra que el valor por defecto del backend (uno) es incorrecto en dev: hoy `req.ip` es la dirección del extremo de CloudFront, compartida por todos los visitantes de ese extremo, y uno de ellos podría agotar el cupo de los demás. Hay que dejar `TRUST_PROXY_HOPS` como clave de ejemplo en cada entorno y documentar la medición, la tabla cadena a valor y lo que queda por confirmar.

## Lo que se sabe del código de infra (verificado en `modules/beanstalk/main.tf`)

- Ambos entornos usan nginx como proxy de la plataforma (`ProxyServer = nginx`); el puerto del proceso por defecto es el ochenta y el de la aplicación, el de `PORT`.
- Con `load_balancer_type = "single"` el entorno es de instancia única (sin balanceador); con otro valor es con balanceador. Los valores efectivos de `dev` y `prod` en sus `main.tf` hay que leerlos al planificar (los `.tfvars` reales no se leen).
- Con `enable_cdn` el módulo crea una distribución de CloudFront delante del CNAME de Beanstalk, con origen solo HTTP; la lista de cabeceras reenviadas no incluye `X-Forwarded-For` y CloudFront la gestiona por su cuenta (comportamiento medido, ver «Medición»).

## Medición

Hecha el 31/10/2026 (entre las 22:37 y las 22:38 UTC) sobre el entorno de backend de dev (perfil `sigmetum-preprod`), con `request-environment-info` y `retrieve-environment-info` (tail) y peticiones marcadas con `curl` desde la máquina de trabajo contra la URL de CloudFront del backend de dev. Las direcciones reales no se documentan: en este y en los demás documentos solo van marcadores (`<IP-visitante>`, `<IP-falsa>`, `<extremo-CloudFront>`).

### MEDIDO (lo que recibe nginx en dev)

- Peticiones sin cabecera `X-Forwarded-For` propia: en el registro de acceso de nginx, `remote_addr` = `<extremo-CloudFront>` (una dirección del rango de CloudFront, la del extremo y no la del visitante), `User-Agent` = «Amazon CloudFront», y la cabecera `X-Forwarded-For` que recibe nginx contiene una sola entrada: `<IP-visitante>`.
- Peticiones con `X-Forwarded-For` falsificada por el cliente: la cabecera que recibe nginx es `<IP-falsa>, <IP-visitante>`. CloudFront añade la IP real del visitante a la derecha y conserva la falsificada a la izquierda.
- Recorrido en dev: visitante, CloudFront, nginx (su dirección de conexión es el extremo de CloudFront), Express.

### DEDUCIDO (lo que recibe Express en dev)

Se deduce de la configuración estándar de Beanstalk para nginx (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`), **no leída en la instancia (por confirmar)**: nginx añade la dirección que le conecta, así que Express vería `[<IP-falsa>,] <IP-visitante>, <extremo-CloudFront>`, con nginx (loopback) como socket.

Cálculo con `trust proxy` = N en Express (cuenta saltos de confianza empezando por el socket):

- N = uno: confía solo en nginx; `req.ip` = `<extremo-CloudFront>`. Incorrecto (cupo compartido por visitante de ese extremo).
- N = dos: confía en nginx y en el extremo de CloudFront; `req.ip` = `<IP-visitante>`; la entrada falsificada a la izquierda se ignora. Valor correcto para dev.
- N = tres: tomaría la entrada falsificable. Incorrecto (esquiva el límite).

Conclusión para dev: el valor es dos. La hipótesis de dos saltos se confirma en lo medido; lo único no medido directamente es lo que nginx añade al reenviar a Express.

### POR CONFIRMAR

- Prod: no hay perfil en la máquina de trabajo. Recorrido esperado: visitante, ALB, nginx, Express (el ALB añade la IP del visitante a `X-Forwarded-For`; nginx añade la del ALB); valor esperado también dos. En el log de nginx de prod se esperaría `remote_addr` = dirección del ALB y `X-Forwarded-For` = IP del visitante. Se confirma con el procedimiento de paquete de logs descrito en las decisiones.
- La configuración real de nginx en la instancia de dev (la deducción de arriba).

## Decisiones registradas

Las respuestas del usuario cierran todas las preguntas anteriores:

1. Medición en dev autorizada de forma expresa (solo dev, perfil `sigmetum-preprod`, paquete de logs de Beanstalk). Ya realizada.
2. Si la medición contradice la hipótesis: se fija el valor medido si es inequívoco; si no lo es, `backend:I7` queda abierto. En dev la medición respalda la hipótesis (valor dos), así que se fija.
3. Prod: el ejemplo lleva el mismo valor que dev, comentado como por confirmar. Se documentan solo `dev` y `prod`, y se avisa al backend de que su documento habla de tres entornos. El procedimiento de prod pide el paquete de logs de nginx con el mismo método que dev, sin activar el registro de acceso del ALB, y lo ejecuta quien tenga acceso a prod.
4. **Restricción de red del origen de dev, incluida en este ciclo (decisión del usuario en la puerta del plan, 31/10/2026).** Verificado ese día (solo lectura): el origen de Beanstalk de dev responde por HTTP directo, sin pasar por CloudFront, y su grupo de seguridad admite el puerto 80 desde cualquier origen. Con dos saltos de confianza eso permite falsificar `X-Forwarded-For` en las peticiones directas y esquivar los límites de login y `/send-email` (S17, nuevo hallazgo). Se restringe el origen de dev para que solo admita tráfico de CloudFront (lista de prefijos gestionada de CloudFront en el grupo de seguridad, o cabecera secreta que compruebe nginx: lo decide el architect y justifica; si exige un fichero de configuración de nginx en el repositorio del backend, está fuera de alcance y se elige la otra vía). Es un cambio de red y TLS de dev, crítico, que puede reconfigurar o reemplazar la instancia de dev; prod no cambia (su instancia está detrás de un ALB, por confirmar). El `plan` y el `apply` los ejecuta el humano. Criterio de aceptación añadido: tras el `apply`, `curl` directo al CNAME de Beanstalk de dev deja de responder (tiempo de espera o rechazo) y el tráfico por CloudFront sigue dando `200`; por confirmar hasta ese `apply`.

## Criterios de aceptación

### De código

1. `environments/dev/terraform.tfvars.example` contiene la clave `TRUST_PROXY_HOPS` dentro de `app_env_vars` con el valor dos (medido en dev); ningún otro valor del archivo cambia. Observable con `git diff` (solo una línea añadida, más su comentario si lo lleva).
2. `environments/prod/terraform.tfvars.example` contiene la clave `TRUST_PROXY_HOPS` con el mismo valor que dev y un comentario en la línea que lo marca como por confirmar; ningún otro valor cambia.
3. No se lee `terraform.tfvars` ni se toca `modules/beanstalk` (la `validation` de `app_env_vars` exige las nueve claves obligatorias y acepta extras).
4. `terraform fmt -check -recursive`, `terraform validate` en `dev` y `prod`, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` pasan.
5. En este ciclo no se ejecuta `plan`, `apply` ni ningún comando de AWS que cree, cambie o borre recursos (la medición ya está hecha y su paquete de logs ya fue autorizado).

### De documentación

1. `docs/referencia-modulos.md`: la clave `TRUST_PROXY_HOPS` aparece en la tabla de claves de `app_env_vars` como opcional (el backend usa uno si no se define), con su regla de valor y sin valores secretos; coincide con los `.tfvars.example` (lo comprueba `docs-check`).
2. `docs/integracion/para-backend.md`, secciones dos y seis: la clave, el valor medido en dev, el procedimiento de medición, la tabla cadena a valor (cada fila marcada como medida, deducida o por confirmar, según «Medición») y el procedimiento exacto para que quien tenga acceso a prod pida el paquete de logs de nginx con el mismo método que dev; ids con su prefijo (`backend:I7`, `infra:C12`). Solo marcadores en lugar de direcciones.
3. `docs/estado-y-deuda-tecnica.md`: `backend:I7` pasa a «resuelto en repo para dev, pendiente del apply del humano; prod por confirmar». Se registra el hallazgo de que el valor por defecto (uno) es incorrecto en dev y el hallazgo lateral descrito en «Fuera de alcance». Fecha de «Última actualización» al día. La cifra de claves de `app_env_vars` se actualiza allí, escrita con letras.
4. Se indica que cambiar `app_env_vars` en Beanstalk reconfigura el entorno y puede reiniciar la aplicación (el apply lo ejecuta el humano), y que el backend ya soporta la variable (M12), así que no hay orden de despliegue previo.
5. Se señala al backend qué corregir en su `para-infra.md`: la contradicción entre «nginx (loopback) a Express» y «ALB, nginx, Express»; su afirmación de que la variable «no se fija ningún valor por entorno»; que el valor por defecto es incorrecto en dev; y que este repositorio solo tiene dos entornos (`dev` y `prod`) aunque su documento habla de tres.
6. Cifras volátiles escritas con letras (regla de `docs-check`); sin secretos, ARN, identificadores de cuenta ni direcciones IP reales.

### Verificación posterior al apply (a cargo del humano)

Debe cerrar la deducción sin enviar correos ni gastar el cupo de login de otros usuarios:

1. Tras fijar `TRUST_PROXY_HOPS=2` en dev y aplicar, hacer peticiones repetidas a una ruta del backend que tenga límite de intentos y cuya repetición no cause daños, desde dos IP distintas (por ejemplo, la máquina de trabajo y un móvil con datos). Pasa si cada IP agota su propio cupo sin afectar al de la otra (con el valor uno, ambas compartirían el cupo del extremo de CloudFront).
2. No sirven para esta prueba `POST /send-email` (envía correos) ni el login (gasta cupo y puede afectar a cuentas reales). Si no existe otra ruta con límite y sin efectos, la verificación queda **por confirmar** y se dice así en la documentación. Si existe tal ruta es **por confirmar**: no se ha identificado (corresponde al backend indicarla).
3. Alternativa de apoyo, también por confirmar: leer la configuración de nginx de la instancia de dev en un paquete de logs o de configuración para cerrar la deducción de lo que recibe Express.

## Fuera de alcance

- Cambios en el backend (código ni documentos).
- S3 y M5, S2, S6, S9, S11 y el resto de la deuda.
- Cambiar la cadena de proxies (añadir o quitar CloudFront, ALB o nginx) o la configuración de nginx.
- `plan`, `apply` o cualquier cambio de recursos; los ejecuta el humano.
- Medir prod desde esta máquina (no hay perfil): queda como procedimiento documentado.
- Hallazgo para otro ciclo (no se trata aquí): la web de dev sirve el build de DESARROLLO de React (el bundle desplegado contiene `react-dom.development` y el aviso «Download the React DevTools»). Muy probablemente Amplify define `NODE_ENV=dev` (valor no estándar) y eso impide que Vite fije `production` en el bundle (causa por confirmar). Contradice el cierre de M2 («no afecta») hecho el mismo día. Se tratará en un ciclo propio: reabrir M2 y quitar o fijar `NODE_ENV=production` en `modules/amplify`. Solo se anota como hallazgo en `docs/estado-y-deuda-tecnica.md`.

## Impacto en contratos externos

- `docs/integracion/para-backend.md`: lo afecta (crítico). Nueva clave opcional en `app_env_vars`; valor por entorno; el valor por defecto del backend (uno) es incorrecto en dev, con efecto sobre los límites de login y de `/send-email`. Orden: el backend ya soporta la variable; el apply de infra no depende de un despliegue previo. El reinicio de la aplicación al aplicar es el único efecto operativo. El backend debe corregir su documento (ver criterio de documentación cinco).
- `docs/integracion/para-frontend.md`: no lo afecta en este ciclo (ni `VITE_*`, ni `build_spec`, ni dominios, ni bucket). El hallazgo de `NODE_ENV` en Amplify sí lo afectará en su ciclo propio.

## Preguntas abiertas

Ninguna.
