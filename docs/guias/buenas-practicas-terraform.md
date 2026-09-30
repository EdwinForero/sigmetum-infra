# Buenas prácticas de Terraform

Normas para escribir y cambiar la infraestructura de este repositorio, con el estado real de cada una. Cada regla dice **qué**, **por qué**, **cómo se comprueba** y **cómo está hoy**.

- Complementa a [seguridad.md](seguridad.md) (seguridad de la infraestructura) y a [mantenimiento.md](mantenimiento.md) (documentación y definición de terminado).
- Los hallazgos con id están en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md). Variables y outputs, en [referencia-modulos.md](../referencia-modulos.md).
- La puerta automática es `node scripts/quality-check.mjs`; la deuda conocida está listada en su constante `KNOWN_DEBT`, para que no pueda extenderse a nada nuevo.
- Si un cambio contradice una regla de esta guía, **avisa y pregunta** antes de hacerlo. Si la guía y el código se contradicen, dilo: no des por buena ninguna de las dos.
- **(verificado)** = comprobado contra el código a fecha 30/09/2026. **(por confirmar)** = depende de la cuenta real de AWS.

## 1. Reglas

### BP-1. Estructura: módulos pequeños y entornos que solo componen

- **Regla:** `modules/` contiene piezas reutilizables con una responsabilidad (red, cómputo, almacenamiento, frontend, DNS). `environments/` no define recursos propios: llama a módulos y les pasa valores. Los dos entornos se mantienen **alineados**; una diferencia intencionada (balanceador solo en prod, DNS solo en prod) se explica en la tabla del [README](../../README.md).
- **Por qué:** cada entorno vive en una cuenta distinta; si difieren sin que se sepa, lo que se prueba en preprod no se parece a lo que se despliega en prod.
- **Cómo:** `docs-check` exige que todo módulo lo use algún entorno y esté en el README y en la referencia. La alineación entre entornos es revisión manual (compara los dos `main.tf`).
- **Estado:** cumple. Los entornos no declaran recursos. Dos valores de configuración siguen escritos a mano en el entorno en lugar de ser variables (la zona `sigmetum-a.org` en prod y la rama de Amplify); es aceptable mientras solo haya un valor posible. `ssl_certificate_arn` está declarada en dev sin usarse (M1).

### BP-2. Variables: tipo, descripción, validación y `sensitive`

- **Regla:** toda variable lleva `type` y `description`. Lleva `validation` cuando hay valores que no tienen sentido (como `load_balancer_type`). Un secreto lleva `sensitive = true`. Los valores por defecto son seguros (por ejemplo, SSH cerrado). Nada de valores reales en `terraform.tfvars.example`: solo marcadores (`CHANGE_ME_...`, `YOUR_...`).
- **Por qué:** la descripción es la documentación que ve quien lee `terraform plan`; la validación falla antes de tocar AWS; `sensitive` evita imprimir el valor en la salida.
- **Cómo:** `quality-check` falla con variables nuevas sin `type` o `description`, con nombres de secreto (`password`, `secret`, `token`, `key`, `env_vars`) sin `sensitive = true`, y con secretos o identificadores de cuenta en los ejemplos. `docs-check` compara las variables con la referencia.
- **Estado:** parcial. Todas tienen `type`; las que no tienen `description` están registradas como deuda (M7). Solo una tiene `validation`. Las claves obligatorias de `app_env_vars` no se validan, por lo que falta alguna hasta que el backend no arranca (C5): una `validation` que exija `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ALLOWED_ORIGIN` lo evitaría (**por confirmar** que la validación funcione sobre un mapa sensible en la versión de Terraform en uso).

### BP-3. Outputs: solo lo necesario y nunca secretos

- **Regla:** un módulo expone solo lo que otro módulo o un entorno consume, o lo que una persona necesita ver tras el `apply`. Cada output lleva `description`. Un output que derive de un valor sensible lleva `sensitive = true`.
- **Por qué:** los outputs aparecen en la salida y en el estado; cada uno es una interfaz que hay que mantener.
- **Cómo:** `quality-check` falla si un output parece secreto o usa una variable sensible sin `sensitive`. `docs-check` compara los outputs con la referencia.
- **Estado:** sin secretos en los outputs (verificado). Varios outputs de módulo no los consume ningún entorno (por ejemplo `app_id`, `bucket_arn`, `zone_id`, `load_balancers`); no hacen daño, pero hay que decidir si se quedan. La mayoría carece de `description` (M7).

### BP-4. Versiones y archivo de bloqueo

- **Regla:** `required_version` y cada proveedor llevan un rango acotado (`~>`). **`.terraform.lock.hcl` se versiona, uno por entorno**, y se actualiza en una PR propia con `terraform init -upgrade`. Para que sirva a todo el equipo se generan los hashes de las plataformas en uso (`terraform providers lock -platform=windows_amd64 -platform=linux_amd64 -platform=darwin_arm64`).
- **Por qué:** sin el archivo de bloqueo, dos personas (o un `init` futuro) pueden resolver versiones distintas del proveedor y obtener `plan` diferentes para el mismo código. La documentación de HashiCorp recomienda versionarlo.
- **Decisión de este repositorio:** se versiona. Todavía no se ha aplicado porque implica modificar `.gitignore` y generar los archivos (cambio fuera del alcance de la revisión que escribió esta guía).
- **Cómo:** `quality-check` muestra el `.gitignore` actual como deuda (M5) y fallará si el archivo deja de estar ignorado sin estar versionado.
- **Estado:** el proveedor `aws` está en `~> 5.0` (verificado). `required_version` es `>= 1.5` sin techo: aceptable mientras se use una versión reciente de Terraform, pero obliga a subirlo si se adopta `use_lockfile` (BP-5). **`.terraform.lock.hcl` está en `.gitignore`: incumple la decisión (M5).**

### BP-5. Estado remoto: cifrado, versionado, bloqueo y acceso

- **Regla:** cada cuenta tiene su bucket de estado, con versionado, cifrado, bloqueo de acceso público y política que exija TLS. El `backend "s3"` activa `encrypt = true` y un bloqueo de concurrencia (`use_lockfile = true` en las versiones recientes de Terraform, o una tabla de DynamoDB). **Solo quien despliega puede leerlo**: el estado contiene en claro los valores de `app_env_vars` y el token de GitHub.
- **Por qué:** sin bloqueo, dos `apply` a la vez corrompen el estado; sin versionado, un error no se puede deshacer; y quien lea el estado lee los secretos.
- **Cómo:** `quality-check` avisa de los `backend` sin `encrypt` ni bloqueo (deuda S3). La configuración del bucket de estado depende de la cuenta: **(por confirmar)**.
- **Estado:** estado remoto en S3, un bucket por cuenta, con versionado activado a mano (verificado en [aws-organizations-setup.md](../aws-organizations-setup.md)). Los `backend.tf` no tienen `encrypt` ni bloqueo (S3). El procedimiento manual no crea el bloqueo de acceso público ni la política TLS del bucket (S4). Quién puede leerlo: **(por confirmar)** (S2).

### BP-6. Etiquetado

- **Regla:** `default_tags` del proveedor con `Project`, `Environment` y `ManagedBy`, y `Component` (`backend`, `frontend`, `storage`) en cada recurso que admita etiquetas. Los recursos creados a mano (buckets de estado, roles) llevan las mismas etiquetas.
- **Por qué:** Cost Explorer reparte los costes por etiqueta ([billing-tags.md](../billing-tags.md)); un recurso sin ella queda en "sin asignar".
- **Cómo:** `quality-check` exige `Component` en los recursos etiquetables de los módulos y las tres etiquetas en `default_tags`. `docs-check` comprueba que figuren en `billing-tags.md`.
- **Estado:** cumple salvo `aws_amplify_branch`, que no lleva `Component` (M8). Los recursos manuales usan `Component=infrastructure`, valor que no figura en `billing-tags.md` (M8).

### BP-7. Flujo de cambio

- **Regla:**
  1. Cambio en una rama; `terraform fmt -check -recursive` → `terraform validate` (cada entorno) → `node scripts/quality-check.mjs` → `node scripts/docs-check.mjs`.
  2. `terraform plan` en **preproducción** (`environments/dev`, cuenta preprod), **revisado por una persona**. No se pega su salida en la PR (puede incluir valores sensibles).
  3. `terraform apply` **solo con confirmación expresa** de la persona responsable, con el perfil de la cuenta correcta. Claude Code no ejecuta `apply` ni `destroy`.
  4. Se comprueba el resultado (sección 8 de [para-infra.md](../../../sigmetum-frontend/docs/integracion/para-infra.md)).
  5. Solo entonces se repite en **producción** (`environments/prod`, cuenta prod) desde `master`.
- **Promoción entre ramas:** los cambios se prueban en `feature/testing` (preproducción) y se fusionan en `master` antes de aplicarse en prod. El resto de ramas solo hacen `plan`. **(por confirmar)** si existe una regla de protección de ramas en GitHub.
- **Por qué:** `apply` cambia recursos reales, algunos con datos (S3) y otros con coste (ALB); prod no debe ser el primer sitio donde se prueba un cambio.
- **Cómo:** la CI (`.github/workflows/ci.yml`) ejecuta `fmt`, `validate`, `quality-check` y `docs-check` en cada PR, **sin credenciales de AWS, sin `plan` y sin `apply`**. El `plan` y el `apply` son siempre manuales; un rol OIDC de solo lectura para publicar el `plan` de preprod en la PR es una mejora futura (M10).
- **Estado:** la CI existe en el repositorio; que bloquee la fusión depende de la protección de la rama principal en GitHub, que no está en el código **(por confirmar)** (M9).

### BP-8. Protección contra borrado

- **Regla:** los recursos con datos que no se pueden recrear (bucket de datos, bucket de estado) llevan `prevent_destroy = true` o una protección equivalente. `force_destroy` no se activa. Un `terraform destroy` exige vaciar el bucket a mano, a propósito.
- **Por qué:** un `destroy` o un cambio de nombre que fuerce el reemplazo borraría la investigación subida por el equipo.
- **Cómo:** `quality-check` avisa de los buckets sin `prevent_destroy` (deuda M6).
- **Estado:** el bucket de datos **no** tiene `prevent_destroy` (M6). No tiene `force_destroy`, así que `destroy` falla si hay objetos (verificado; [README](../../README.md#destroy-an-environment) lo explica). El bucket de estado no lo gestiona Terraform (M3).

### BP-9. Costes

- **Regla:** las decisiones que cuestan dinero se justifican en el código o en el README: tipo de instancia mínimo, balanceador solo en prod, versionado de S3 con una regla de ciclo de vida para las versiones antiguas. Antes de un `apply` se revisa en el `plan` qué recursos nuevos se crean y se estima su coste mensual.
- **Por qué:** un ALB o una instancia mayor se facturan cada mes; nadie lo nota hasta que llega la factura.
- **Cómo:** manual (estimación con el precio de la región, anotada en la PR; ver [mantenimiento.md](mantenimiento.md#6-listas-de-comprobación-por-tipo-de-cambio)). Las etiquetas (BP-6) permiten ver el coste por componente.
- **Estado:** instancia mínima en ambos entornos y balanceador solo en prod (verificado en `environments/*/main.tf`, con el ahorro indicado en un comentario). El bucket versiona sin regla de ciclo de vida (las versiones antiguas se acumulan). No hay alertas de facturación en Terraform (S11).

### BP-10. Nombres y estilo

- **Regla:** `snake_case`; nombres de recurso coherentes; los comentarios explican el **porqué** (una restricción, un coste, una decisión) y no repiten el código. **Sin `provisioner`, `null_resource` ni `local-exec`.** `terraform fmt` antes de cada commit.
- **Por qué:** los provisioners esconden pasos que Terraform no puede planificar ni revertir.
- **Cómo:** `quality-check` falla con `provisioner`, `null_resource`, `local-exec` o `remote-exec`, y con archivos que no pasan `terraform fmt`.
- **Estado:** cumple, sin provisioners. El recurso principal se llama `this` en unos módulos y `app` en `storage` (incoherencia menor). `environments/prod/main.tf` no pasa `fmt` (M4).

### BP-11. Interfaz con el frontend y el backend

- **Regla:** lo que recibe el frontend (variables `VITE_*` de Amplify, `build_spec`, dominios) y lo que exige el backend (`config/validateEnv.js`) es un **contrato**. Antes de cambiarlo, se lee [para-infra.md](../../../sigmetum-frontend/docs/integracion/para-infra.md) y `../sigmetum-backend/config/validateEnv.js`, y la PR dice qué debe hacer cada repositorio (ver [mantenimiento.md](mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios)).
- **Por qué:** los tres repositorios se despliegan por separado. Una variable mal nombrada no falla en Terraform: falla en el navegador o al arrancar el backend.
- **Cómo:** `docs-check` y `quality-check` comparan las `VITE_*` de `modules/amplify` con el `.env.example` del frontend y las claves de `app_env_vars` con las obligatorias del backend. Si falta un repositorio hermano, avisan y siguen.
- **Estado:** **incumple, y está registrado:** Amplify define `VITE_API_URL` y el frontend lee otras (C1); `app_env_vars` no incluía las claves `ADMIN_*` y `ALLOWED_ORIGIN` en los `terraform.tfvars` reales (C5); el health check no coincide con la ruta del backend (C6).

### BP-12. Anti-patrones presentes en el código

Lo que no se debe imitar y ya está registrado:

| Anti-patrón | Dónde | Hallazgo |
|---|---|---|
| URL del backend en `http://` construida con el endpoint | `environments/dev/main.tf` | C4 |
| Health check a `/` cuando la ruta de salud es `/healthcheck` | `modules/beanstalk/main.tf` | C6 |
| Variable de entorno con el nombre equivocado para el frontend | `modules/amplify/main.tf` | C1 |
| `NODE_ENV` con un valor no estándar (`dev`, `prod`) | `modules/amplify/main.tf` | M2 |
| Nombre del rol de Beanstalk escrito a mano en el módulo de almacenamiento (acopla el módulo a un rol creado fuera de Terraform) | `modules/storage/main.tf` | M3, S7 |
| Variables declaradas y sin uso | `environments/dev/variables.tf`, `modules/networking/variables.tf` | M1 |
| Variables sin `description` y outputs sin documentar | varios | M7 |
| `output` que construye una URL con `/` en el nombre de rama | `modules/amplify/outputs.tf` | C8 |
| Secretos pasados como propiedades de entorno de Beanstalk | `modules/beanstalk/main.tf` | S6 |
| `.terraform.lock.hcl` ignorado | `.gitignore` | M5 |

## 2. Estado actual (revisión del 30/09/2026)

| Comprobación | Resultado |
|---|---|
| `terraform fmt -check -recursive` | Falla en `environments/prod/main.tf` (M4) |
| `terraform validate` en `dev` y `prod` | Sin errores |
| Proveedor `aws` | `~> 5.0` |
| `required_version` | `>= 1.5` (sin techo) |
| `.terraform.lock.hcl` versionado | **No** (M5) |
| Entornos que solo componen módulos | Sí |
| Provisioners o `null_resource` | Ninguno |
| Variables sin `description` | Deuda registrada (M7) |
| Secretos en `.tf`, ejemplos y documentos | Ninguno (`quality-check`) |
| Bloqueo de concurrencia y `encrypt` en el estado | No (S3) |
| `prevent_destroy` en el bucket de datos | No (M6) |
| Etiqueta `Component` | En todos los recursos etiquetables salvo la rama de Amplify (M8) |
| Integración continua | `ci.yml` sin credenciales de AWS; escaneo `trivy config` informativo (M9) |

## 3. Lista de comprobación para una PR

Márcala **siempre** que el cambio toque un `.tf`.

- [ ] `terraform fmt -check -recursive` y `terraform validate` de `dev` y `prod` en verde.
- [ ] `node scripts/quality-check.mjs` y `node scripts/docs-check.mjs` en verde (o la deuda nueva registrada).
- [ ] Variables con `type`, `description` y, si procede, `validation` y `sensitive`.
- [ ] Outputs con `description`, sin secretos.
- [ ] Recursos etiquetables con `Component`.
- [ ] Los dos entornos siguen alineados (o la diferencia está explicada en el README).
- [ ] Sin `provisioner` ni valores reales en ejemplos o documentos.
- [ ] `plan` de preprod revisado por una persona (sin pegar su salida); coste estimado si hay recursos nuevos.
- [ ] Sin `apply` ni `destroy` ejecutados sin confirmación expresa.
- [ ] Si toca el contrato con el frontend o el backend, la PR dice qué debe hacer cada uno.
- [ ] Documentación actualizada según [mantenimiento.md](mantenimiento.md#2-qué-documento-tocar-según-el-cambio).
- [ ] Si toca IAM, S3, secretos, red, TLS, Amplify o variables sensibles, también la lista de [seguridad.md](seguridad.md#3-lista-de-comprobación-para-una-pr).

## 4. Mantener esta guía

- Cuando se resuelve un hallazgo citado aquí, se actualiza la regla y la tabla de estado.
- Una comprobación manual que se pueda automatizar pasa a `scripts/quality-check.mjs`.
- La deuda aceptada vive en `KNOWN_DEBT` del script y en [estado-y-deuda-tecnica.md](../estado-y-deuda-tecnica.md); al resolverla se quita de ambos.
