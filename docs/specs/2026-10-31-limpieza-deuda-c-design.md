# Limpieza de deuda de infra (ciclo C): spec

Fecha: 2026-10-31 · Estado: cerrado

## Objetivo

Cerrar cinco hallazgos de bajo riesgo de [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md) (M1, M4, M2, M7, S1) sin crear recursos de AWS nuevos: quitar variables sin uso, retirar una entrada obsoleta, cerrar M2 como «no afecta» (sin cambio de código), completar descripciones, añadir una `validation` de las claves obligatorias de `app_env_vars` y sustituir identificadores de cuenta reales por marcadores.

**Criticidad estimada: alta en M7** (contrato con el backend: `modules/beanstalk` y `environments/**` son `areasContrato`). M1, M4 y S1 son bajas (S1 toca documentos con datos de cuenta). M2 ya no cambia código. El `apply` y el `plan` los hace el humano.

## Decisiones registradas

1. **M2**: `NODE_ENV` se deja como está; no se cambia código. M2 se cierra como «no afecta» a la compilación en `dev`. Evidencia (comprobada por el orquestador en el log del paso BUILD del build #7 de la rama `feature/testing` en el Amplify de `dev`, con la app llevando `NODE_ENV=dev`, valor no estándar): Vite 6.4.3 imprime «building for production...», transforma los módulos del proyecto (cuatrocientos cincuenta y siete), genera `dist/` minificado y termina en 3,23 s sin avisos sobre `NODE_ENV`. En `prod` el valor es `prod` y el módulo es el mismo, pero no se ha compilado desde aquí: **(por confirmar)**. No se pide ningún build nuevo ni autorización para lanzar builds.
2. **Comprobación del build**: resuelta con la evidencia anterior; no hay nada que lanzar ni autorizar.
3. **M7, outputs**: no se poda ninguno. Solo se añaden `description` a los outputs que no la tengan (y a las variables). Los siete outputs sin consumidor quedan como están y se registran en el estado y, si procede, en `KNOWN_DEBT`: `storage:bucket_arn`, `beanstalk:environment_name`, `beanstalk:application_name`, `beanstalk:load_balancers`, `amplify:app_id`, `amplify:default_domain`, `dns:zone_id`.
4. **M7, validation**: sí, una `validation` de las nueve claves obligatorias de `app_env_vars`, solo en la variable `app_env_vars` de `modules/beanstalk` (no en los entornos). Es una restricción que el backend ya exige al arrancar (`validateEnv`), así que no cambia el contrato.
5. **S1**: un marcador por cuenta: `<ID_CUENTA_DEV>`, `<ID_CUENTA_PROD>` y `<ID_CUENTA_GESTION>`. Correspondencia leída del contexto de las guías (sin imprimir identificadores): la cuenta `sigmetum-preprod` es la de `environments/dev` (`aws-organizations-setup.md` la rotula así) y por tanto `<ID_CUENTA_DEV>`; `sigmetum-prod` es `<ID_CUENTA_PROD>`; la cuenta management (la que ejecuta Terraform y crea Organizations) es `<ID_CUENTA_GESTION>`. Los cinco identificadores de `aws-cli-setup.md` y los cuatro de `aws-organizations-setup.md` quedan asignados sin ambigüedad.

## Criterios de aceptación

### De código

**M1 (comprobado con Grep al escribir la spec)**
1. `ssl_certificate_arn` de `environments/dev/variables.tf`: no se referencia en `environments/dev/main.tf` ni en otro `.tf` de `dev`. Se puede quitar. NO se quita la de `environments/prod` ni la de `modules/beanstalk` (se usan). Los nombres de claves del `terraform.tfvars` de `dev` no se leen; si ese archivo define la clave, Terraform avisa de variable no declarada (aviso, no error): es acción del humano quitarla. Al terminar, `grep ssl_certificate_arn environments/dev` (sin `terraform.tfvars`) no da resultados.
2. `environment` de `modules/networking/variables.tf` no se usa dentro del módulo, pero `environments/dev/main.tf` y `environments/prod/main.tf` la pasan (`environment = "dev"` / `"prod"`). Quitarla exige quitar también esa línea en ambos `main.tf`; con eso el módulo queda sin variables (el archivo `variables.tf` quedaría vacío: la decisión de borrarlo o dejarlo es del plan). `terraform validate` pasa en `dev` y `prod`.

**M4**
3. `terraform fmt -check -recursive` pasa (ya pasa, comprobado en estado). Se quita la clave `fmt` de `KNOWN_DEBT` en `scripts/quality-check.mjs` (hoy lista `environments/prod/main.tf`) y `node scripts/quality-check.mjs` sigue en verde.

**M2**
4. `NODE_ENV` en `modules/amplify/main.tf` no cambia (decisión 1). Ningún `.tf` de Amplify se modifica por M2. El efecto en `prod` queda **(por confirmar)**.
5. Hecho: `aws_amplify_branch.this` no define `NODE_ENV` (solo la app); no se toca.

**M7**
6. Todas las variables de `modules/*/variables.tf` y `environments/*/variables.tf` tienen `description`, y todos los outputs de `modules/*/outputs.tf` y `environments/*/outputs.tf` también. Sin cambiar `type`, `default`, `sensitive` ni nombres, y sin podar ningún output (decisión 3). `KNOWN_DEBT.noDescription.names` queda vacío (`names: []`) o se elimina con su comprobación, sin romper `quality-check`; las entradas de variables que se quiten en M1 desaparecen de la lista.
7. Las descripciones de variables sensibles (`github_access_token`, `app_env_vars`) no incluyen valores, solo el propósito.
8. `validation` en la variable `app_env_vars` de `modules/beanstalk/variables.tf` (y solo ahí): exige exactamente las nueve claves de `required` de `../sigmetum-backend/config/validateEnv.js`, por nombre: `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `EMAIL`, `EMAIL_PASSWORD`, `AWS_REGION`, `AWS_BUCKET_NAME`, `ALLOWED_ORIGIN`. Condiciones:
   - No exige claves de más (`PORT`, `TRUST_PROXY_HOPS`, `AWS_PROFILE` y `NODE_ENV` no son obligatorias); no cambia valores ni los `.tfvars.example`; no se añade validación en `environments/*/variables.tf`.
   - Debe funcionar con `type = map(string)` y con `sensitive = true`, y no romper el uso de `nonsensitive(var.app_env_vars)` del módulo. Ni la condición ni el mensaje de error pueden revelar valores, solo nombres de claves.
   - Las variables de los entornos (`default = {}`) pasan siempre `app_env_vars` al módulo: un `app_env_vars` vacío o incompleto pasa a ser un error de validación (es la intención; el backend ya no arrancaría).
   - Cómo se comprueba: (a) `terraform validate` en `dev` y `prod` en verde (no prueba la condición con valores reales, porque `validate` no evalúa las variables de `.tfvars`); (b) lectura de la condición contra los **nombres** de clave de `environments/dev/terraform.tfvars.example` y `environments/prod/terraform.tfvars.example` (que contienen las 9 obligatorias; no se lee `terraform.tfvars`); (c) el humano ejecuta `terraform plan` en `dev` y `prod` con sus `terraform.tfvars` reales y confirma que la validación pasa **(por confirmar)**, porque ningún rol del ciclo ejecuta `plan`.
9. `node scripts/docs-check.mjs` pasa (las métricas de `estado-y-deuda-tecnica.md` y las tablas de `referencia-modulos.md` coinciden con el código). `terraform fmt -check -recursive`, `terraform validate` (dev y prod) y `node scripts/quality-check.mjs` en verde.

**S1**
10. Los identificadores de cuenta de 12 dígitos de `docs/aws-cli-setup.md` (5 apariciones, aprox. líneas 24, 86, 104, 116 y 122) y `docs/aws-organizations-setup.md` (4 apariciones, aprox. líneas 6, 48, 91 y 92) pasan a los marcadores de la decisión 5, sin tocar nada más. Se retira `accountIds` de `KNOWN_DEBT` si `quality-check` deja de detectar identificadores. `grep -E "\b[0-9]{12}\b"` en esos dos archivos no da resultados. Si un marcador deja un paso inservible (por ejemplo `sso_account_id` o salidas de ejemplo), se dice en el plan.

### De documentación

1. `docs/estado-y-deuda-tecnica.md`: mover M1, M4, S1 y M7 a "Resueltos"; M2 a "Resueltos" como «no afecta» en `dev` con el efecto en `prod` **(por confirmar)**; en M7, dejar anotado que los siete outputs sin consumidor se mantienen (con su lista) y, si procede, en `KNOWN_DEBT`; "Última actualización: 31/10/2026"; actualizar las métricas con `node scripts/docs-check.mjs --metrics` (variables de módulos, outputs de módulos, archivos .tf); añadir una fila en "Iteraciones". Anotar el hallazgo del frontend (ver "Fuera de alcance").
2. `docs/referencia-modulos.md`: quitar `ssl_certificate_arn` de `dev` (línea de "Declarada pero sin uso") y la variable `environment` de `networking`; reflejar la validación de `app_env_vars`; los outputs no cambian.
3. `docs/guias/buenas-practicas-terraform.md`: quitar las menciones de M1 (estado de BP-2, línea 18) y ajustar la de M2 (línea 106) a «cerrado, no afecta».
4. M2: `docs/integracion/para-frontend.md` (fila de `NODE_ENV`, línea 56) y `docs/referencia-modulos.md` (línea 132) deben decir lo mismo que el código (que no cambia) y la conclusión de M2. No hay aviso de cambio para el frontend: `NODE_ENV = var.environment` sigue siendo cierto.
5. S1: la fila S1 sale de "Abiertos"; las guías mantienen su texto salvo los identificadores.
6. `docs-gate`: comprobar los documentos exigidos por `docsPorArea` (`modules/**`, `environments/**`) y que `docs/guias/mantenimiento.md` (sección 2) no pida más.

## Fuera de alcance

- S3/M5 (estado remoto y archivo de bloqueo), `backend:I7`, S2, S6, S9, S10, S11, S12, S13, S14, M3, M9, M10, M11, B2.
- Cualquier `app_env_vars` de los `.tfvars.example` (claves y valores), el `build_spec`, `VITE_*`, dominios, región y bucket.
- Cambiar `NODE_ENV` de Amplify y podar outputs (decisiones 1 y 3).
- Validación de `app_env_vars` en `environments/*/variables.tf`.
- `terraform plan`, `apply`, `import`, `state` y comandos de AWS que cambien recursos; lanzar builds de Amplify; lectura de `terraform.tfvars`.
- Renombrar recursos (`moved`, M12) y corregir la descripción semántica de `load_balancers` (M12).
- Quitar la variable `ssl_certificate_arn` de `prod` o `beanstalk`.
- **Hallazgo para el frontend (no es de infra; no es un cambio de este ciclo):** el mismo log del build #7 mostró «19 vulnerabilities (13 moderate, 4 high, 2 critical)» tras `npm ci` y un bundle JS de 1.063 kB (aviso de chunks mayores de 500 kB). Es del repositorio `sigmetum-frontend`; el resumen final lo señala.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: **ninguno por código.** M2 no cambia `NODE_ENV` ni nada de `modules/amplify`; la eliminación de variables de `modules/networking`/`dev` no afecta a `VITE_*` ni al `build_spec`. Solo se ajusta el texto de la fila de `NODE_ENV` para reflejar la conclusión de M2.
- `docs/integracion/para-backend.md`: **no cambia el contrato.** La `validation` de `app_env_vars` exige únicamente las nueve claves que `validateEnv` ya exige al arrancar; `app_env_vars` de Beanstalk no se modifica en claves ni valores. `NODE_ENV` de Beanstalk no es el de Amplify y no se toca. Un `app_env_vars` incompleto, que antes pasaba `plan` y fallaba al arrancar el backend, ahora falla en `plan`.
- Efecto en AWS: ningún cambio de recursos (M1, M4, M2, M7 y S1 no cambian infraestructura). Se espera un `plan` sin cambios **(por confirmar con `plan` del humano)**.
- Orden de despliegue: ninguno. Los otros repositorios no tienen que hacer nada por este ciclo, salvo la nota del frontend de "Fuera de alcance".

## Preguntas abiertas

Ninguna.
