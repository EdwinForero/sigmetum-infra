# Seguridad del bucket de datos, IAM de instancias, TLS y ALB: spec

Fecha: 2026-10-30 · Estado: cerrado

Hallazgos: C13, S7 (con backend:B2), S5, M6 y S8 de `docs/estado-y-deuda-tecnica.md`. Criticidad alta: IAM y permisos, bucket de datos, red y TLS, destrucción o reemplazo de recursos.

## Objetivo

Hoy CloudFront puede leer todo el bucket de datos, el rol de instancias de Beanstalk puede escribir y borrar en todo el bucket (incluido `assets/`), el bucket no exige TLS ni está protegido contra borrado ni expira versiones antiguas, y el ALB de prod no redirige de 80 a 443. Se quiere acotar cada acceso al mínimo que usa cada actor, sin romper el backend ni el frontend, y sin que el cambio fuerce recrear el bucket de ningún entorno.

## Decisiones registradas

Decididas por el usuario:

1. S7: el rol de instancias queda acotado en lectura, listado, escritura y borrado a `gallery/` y `data/`; el listado se acota con condición de `Prefix`. `assets/*` queda solo para CloudFront.
2. M6: `prevent_destroy = true` en `dev` y `prod` (un solo recurso en el módulo `storage`). El vaciado manual necesario para destruir un entorno se documenta.
3. M6: las **versiones no actuales** de S3 (las que ya no son la versión vigente de un objeto) se conservan **180 días** y después se expiran. No se expiran los objetos vigentes. Son solo respaldo, porque las versiones de datos del backend son objetos distintos (`AAAA-MM-DD_vN.xlsx`).
4. S5: solo la política TLS (`aws:SecureTransport`). Los registros de acceso quedan como deuda abierta, sin bucket de logs nuevo.
5. S8: redirección 301 en el listener del puerto 80 del ALB de prod, solo si hay ALB y certificado. La política IAM sigue atada al nombre fijo del rol (M3 queda aparte).

Ratificada por el usuario en la puerta humana de requisitos (propuesta por defecto de requisitos):

6. M6: se limpian también los marcadores de borrado huérfanos y las subidas multipart incompletas.

Contexto de prod: el certificado ya existe, pero el usuario aún no hará despliegues en prod. La verificación se hace en `dev` y se espera que `prod` se comporte igual por usar el mismo módulo. El `apply` en prod llegará después.

## Criterios de aceptación

### De código

1. C13a: la política del bucket concede a CloudFront `s3:GetObject` solo sobre `assets/*` (verificable leyendo la política en `modules/storage`; el contenido real de la política aplicada queda **(por confirmar)** con `plan`/`apply` humano).
2. C13b: una petición de CloudFront a una clave fuera de `assets/` (por ejemplo `gallery/…` o `data/…`) no devuelve el objeto (**por confirmar** tras el apply en dev, observación manual; en prod, tras su apply).
3. S7: el rol de instancias solo puede leer (`s3:GetObject`), escribir (`s3:PutObject`) y borrar (`s3:DeleteObject`) sobre `gallery/*` y `data/*` (esto cubre `data/active/`, `data/terms/`, `data/drafts/` y `data/<provincia>/`). El listado del bucket (`s3:ListBucket`) solo se permite con condición de `Prefix` dentro de `gallery/` y `data/`. Sin permiso de lectura, escritura ni borrado sobre `assets/*`.
4. S7: sin comodines en `Action`; los `Resource` son ARN de prefijos concretos del bucket del entorno.
5. S7 (verificación previa): se revisan todos los llamadores de `listObjectsV2`, `ListObjectsV2Command` y `listAllObjects` en `C:\Users\edwin\Music\Repos\sigmetum-backend` y se anota el resultado en la spec o en el aviso de PR (qué llamadores hay y si todos pasan `Prefix` dentro de `gallery/` o `data/`). Lo leído hasta ahora siempre pasa `Prefix`, pero no se han verificado todos los llamadores.
6. S5: el bucket tiene una sentencia `Deny` para `aws:SecureTransport = false` sobre el bucket y sus objetos, conviviendo con la sentencia de CloudFront en un único `aws_s3_bucket_policy` (un bucket solo admite una política).
7. S5 (registros de acceso): no se implementan; se registran como deuda abierta en `docs/estado-y-deuda-tecnica.md` (S5 queda parcial). No se crea ningún bucket de logs.
8. M6: el bucket de datos lleva `prevent_destroy = true` en ambos entornos (un solo recurso en el módulo `storage`).
9. M6: una regla de ciclo de vida expira las versiones no actuales a los 180 días, sin tocar la versión vigente de ningún objeto, y limpia marcadores de borrado huérfanos y subidas multipart incompletas (decisión por defecto 6).
10. M6: `terraform plan` (lo ejecuta el humano) no muestra recreación ni destrucción del bucket, de la distribución de CloudFront ni del rol en ninguno de los dos entornos; los únicos cambios esperados son la política del bucket, la política IAM en línea y la nueva configuración de ciclo de vida (**por confirmar**).
11. S8: en `prod`, el listener del puerto 80 del ALB redirige a HTTPS (443) con redirección permanente 301; en `dev` (instancia única con CloudFront) no cambia nada.
12. S8: la redirección solo se activa si hay ALB y certificado (misma condición que el listener 443), para no romper un entorno sin certificado.
13. Pasan `terraform fmt -check -recursive`, `terraform validate` en `environments/dev` y `environments/prod`, `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs`; el `KNOWN_DEBT` de `quality-check` no conserva las excepciones de S5/M6 que se resuelvan.
14. `dev` y `prod` no divergen sin explicarlo en el `README.md`.

### De documentación

1. `docs/estado-y-deuda-tecnica.md`: C13, S7, M6 y S8 pasan a resueltos o parciales con el estado real; S5 queda parcial (TLS resuelto, registros de acceso como deuda abierta). Lo desplegado en AWS y el efecto de S8 en prod quedan **(por confirmar)** hasta el `apply` en prod. "Última actualización" con la fecha de hoy; backend:B2 se marca como resuelto o dependiente de infra:S7.
2. `docs/referencia-modulos.md`: describe las políticas del bucket y de IAM resultantes, el ciclo de vida (180 días) y la redirección (sin duplicar cifras que ya viven en el estado).
3. `docs/integracion/para-backend.md` (sección 5 y B2): sustituir "no es mínimo privilegio" por los prefijos efectivos, con la lista que debe respetar el backend, la condición de `Prefix` en el listado y la regla de que un prefijo nuevo exige cambiar la política de infra antes.
4. `docs/integracion/para-frontend.md` (línea sobre C13): CloudFront sirve solo `assets/*`; cualquier recurso público debe vivir bajo ese prefijo.
5. `docs/guias/seguridad.md` y `docs/guias/buenas-practicas-terraform.md` (SEG-6, BP-8, tablas de estado): actualizar "Estado" y las filas de cumplimiento.
6. `README.md`: aviso de que `prevent_destroy` bloquea `destroy` en ambos entornos y procedimiento manual de vaciado para destruir un entorno (hoy ya explica que `destroy` falla con objetos).
7. Aviso de PR de `docs/specs/` con qué debe hacer cada repositorio, el resultado de la verificación de llamadores del listado y el orden de despliegue.

## Fuera de alcance

- S3 y M5 (estado remoto y lockfile), C7 (subida de `assets/` al bucket; se resolverá con un script con `aws s3 sync`), C9 (dominios `sigmetum-a.org` y `www.` en prod), C11 y backend:I7.
- Crear o gestionar el rol `aws-elasticbeanstalk-ec2-role` con Terraform (M3).
- Cambios de código en el backend o el frontend.
- Cifrado con KMS, replicación, registros de acceso y bucket de logs (deuda abierta de S5).
- Ejecutar `plan`, `apply` o comandos de AWS: los hace el humano.

## Impacto en contratos externos

- `docs/integracion/para-backend.md`: lo afecta. El backend usa IAM de S3 (`GetObject`, `PutObject`, `DeleteObject`, `ListObjectsV2` con `Prefix`) sobre `gallery/`, `data/`, `data/active/`, `data/terms/`, `data/drafts/` y `data/<provincia>/` (`config/s3Paths.js` y `aws/awsS3connect.js`, verificado). Con la spec no debería necesitar cambios si solo lee, lista, escribe y borra dentro de esos prefijos. **Riesgo:** un listado sin `Prefix` (o con un prefijo fuera de `gallery/` y `data/`) fallaría con acceso denegado; de ahí el criterio de código 5. Tampoco debe leer `assets/` ni la raíz por S3. Las URL prefirmadas se firman con el rol de instancias, por lo que la lectura de `gallery/` y `data/` sigue permitida. S8: nada cambia en `app_env_vars`, pero `X-Forwarded-Proto` y el health check (puerto 80 del grupo de destino) no deben romperse con la redirección (**por confirmar**: el health check va al grupo de destino, no al listener).
- `docs/integracion/para-frontend.md`: lo afecta. El frontend carga recursos por CloudFront (`VITE_S3_URL`); solo `assets/*` seguirá resolviendo. Debe comprobar que no pide por CloudFront ninguna clave fuera de `assets/` (galería o datos). Nada cambia en `build_spec`, `VITE_*`, dominios ni región.
- Orden de despliegue propuesto (el arquitecto lo confirma): 1) frontend y backend verifican que sus rutas y listados están dentro de los prefijos (sin despliegue); 2) infra aplica en `dev` con `plan` revisado por el humano; 3) prueba en dev de subida, listado, lectura prefirmada y borrado del backend y de carga de `assets/` por CloudFront; 4) infra aplica en `prod` más adelante, cuando el usuario decida desplegar en prod. No hay despliegue obligatorio en los otros repositorios si lo anterior se cumple.

## Verificación en dev y prod

- En `dev` se comprueba todo lo observable: política del bucket, IAM, TLS, ciclo de vida, `prevent_destroy` y la carga de `assets/` por CloudFront.
- La redirección 80 a 443 (S8) solo puede comprobarse en `prod` (en dev no hay ALB). Su efecto queda **(por confirmar)** hasta el `apply` en prod.
- El módulo `storage` es el mismo en ambos entornos, por lo que se espera que `prod` se comporte igual que `dev` en bucket e IAM; es una expectativa, no un hecho comprobado (**por confirmar**).
- El certificado de prod ya existe; la spec no fija valores ni ARN del certificado.

## Preguntas abiertas

Ninguna.

Nota: lo desplegado realmente en AWS (política vigente del bucket, existencia del rol, listener del ALB) está **(por confirmar)** hasta que el humano ejecute `plan` y `apply`.
