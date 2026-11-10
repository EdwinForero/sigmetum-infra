# Cognito en corte único: plan

Fecha: 2026-11-03 · Estado: cerrado · Spec: [design](2026-10-31-cognito-corte-unico-design.md)

Plan de 5 pasos de código (una fase) más documentación a cargo del tester. **Crítico: sí.** El architect no leyó en este plan README, estado, seguridad, mantenimiento, buenas-prácticas, para-frontend ni los diagramas completos: usó las líneas que devolvió un `grep` de las cuatro claves. El tester debe repasarlos con `grep` de `JWT_|ADMIN_|POST /log` antes de editar. Los nombres de archivo del plan y del aviso de PR conservan el prefijo `2026-10-31-cognito-corte-unico-`, igual que la spec.

## Comprobaciones previas

- **`nonsensitive` y `merge`: no se ven afectados.**
  - `nonsensitive(var.app_env_vars)` en `modules/beanstalk/main.tf` itera el mapa y no depende de qué claves haya.
  - `merge(var.app_env_vars, {COGNITO_USER_POOL_ID = ...})` está en `environments/{dev,prod}/main.tf` y es anterior al módulo. La `validation` solo existe en el módulo y ve el mapa ya fusionado, así que `COGNITO_USER_POOL_ID` siempre está presente. Los `variables.tf` de los entornos no tienen `validation`: no hay que tocarlos.
- **Avisos de coherencia: siguen siendo avisos, no fallos.** En `quality-check.mjs` la sección 5 hace `check(..., [], notes)`: nunca falla. Con el backend actual avisará de que las plantillas no definen `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` (el backend aún las exige en `required`); son notas y no cambian el código de salida. La dirección contraria no genera avisos nuevos (solo `PORT` y `TRUST_PROXY_HOPS`, exentas). `INJECTED_KEYS` no cambia.
- **`docs-check`: tres consecuencias.**
  - Compara las claves de `app_env_vars` de cada plantilla con las filas de la tabla de `referencia-modulos.md`: plantillas y tabla deben cambiar en el mismo commit. Las cuatro claves **no** deben quedar como filas de la tabla (ni «No»), porque obligarían a las plantillas a definirlas: se mencionan solo en prosa.
  - La métrica «Claves de app_env_vars» (plantilla de dev) baja de 11 a 7: `PORT`, `AWS_REGION`, `AWS_BUCKET_NAME`, `EMAIL_PASSWORD`, `ALLOWED_ORIGIN`, `EMAIL`, `TRUST_PROXY_HOPS`.
  - Con el backend actual, `docs-check` da avisos de «el backend exige X y no está en la tabla»; solo fallan con `--strict`. La CI no usa `--strict`. **`--strict` no puede pasar hasta que el backend cambie.**
- **Regla de cifras de `docs-check`:** fuera del documento de estado y de `mantenimiento.md`, no escribir expresiones tipo «número + claves» con dígito: usar «las cuatro claves».

## Fase 1 (código, 5 pasos)

1. **Relajar la `validation` de `app_env_vars` en el módulo Beanstalk**
   - Archivo: `modules/beanstalk/variables.tf` (modificar, ~líneas 84 a 93).
   - `description`: quitar «JWT_SECRET, EMAIL_PASSWORD and ADMIN_PASSWORD travel as...»; dejar «secrets included (EMAIL_PASSWORD travels as a Beanstalk environment property)», mantener «extra keys are allowed» y la frase de `COGNITO_USER_POOL_ID`. `condition`: la lista pasa a `["EMAIL", "EMAIL_PASSWORD", "AWS_REGION", "AWS_BUCKET_NAME", "ALLOWED_ORIGIN", "COGNITO_USER_POOL_ID"]`. `error_message`: las mismas seis claves, sin nombrar las cuatro retiradas.
   - Comprobación: `terraform fmt -check -recursive`; `terraform init -backend=false && terraform validate` en `environments/dev` y `environments/prod`; `grep` de las cuatro claves en `modules/beanstalk/` sin resultados.
   - Norma: BP-2 y BP-12; `para-backend.md` sección 2.
   - Descartado: una `validation` distinta por entorno (la spec fija una sola); prohibir las cuatro claves en el módulo (rompería prod, que las conserva hasta su corte).
2. **Plantilla de dev sin las cuatro claves**
   - Archivo: `environments/dev/terraform.tfvars.example`. Eliminar `JWT_SECRET`, `ADMIN_PASSWORD`, `JWT_EXPIRATION` y `ADMIN_USERNAME` con sus comentarios (~líneas 31 a 35 y 42 a 46).
   - Reescribir el comentario del bloque de secretos: «Secreto del backend: EMAIL_PASSWORD...», conservando el aviso de que viaja como propiedad de entorno y puede verse en `plan` y en el estado; sin mencionar S18 ni la transición. `EMAIL_PASSWORD = "CHANGE_ME_..."` se mantiene como marcador.
   - Comprobación: `node scripts/docs-check.mjs --metrics` da el valor esperado de claves (ver estado); la comprobación completa la hace el tester (la tabla de la referencia debe cambiar a la vez).
   - Norma: SEG-2 (solo marcadores).
3. **Plantilla de prod sin las cuatro claves**
   - Archivo: `environments/prod/terraform.tfvars.example`. Misma limpieza (~líneas 34 a 40 y 47 a 51) y el mismo comentario de secretos. Añadir dos líneas genéricas sin nombrar las cuatro claves (decisión de la puerta 1): «Las claves extra que ya tengas en tu terraform.tfvars siguen siendo válidas; ver docs/referencia-modulos.md» y **un aviso explícito**: «El backend desplegado en prod aún depende de claves de la transición que ya no están en esta plantilla: no copies esta plantilla sobre un terraform.tfvars en uso». Sin nombrar ninguna de las cuatro claves (la regla nueva de `quality-check` lo permite).
   - **Cómo se documenta un `tfvars` antiguo de prod:** no en la plantilla (la regla nueva y la spec prohíben nombrar las claves allí), sino en prosa en `referencia-modulos.md` (sección `app_env_vars`) y en `para-backend.md` (sección 2), sin filas de tabla: «un `tfvars` de prod que aún las tenga sigue siendo válido, porque la `validation` acepta claves extra; prod las conserva hasta su corte propio (S18-prod)». El README resume lo mismo en su texto de prod.
   - Comprobación: `grep` de las cuatro claves en `environments/*/*.example` sin resultados. El `plan` humano de prod no cambia (**por confirmar**, lo comprueba el humano).
   - Norma: `mantenimiento.md` sección 2 (divergencia dev/prod explicada en el README).
4. **Regla nueva de `quality-check` que FALLA si reaparecen las cuatro claves**
   - Archivo: `scripts/quality-check.mjs`. Dentro del bloque «4. Secretos y archivos que no deben versionarse» (el que produce `problems`; la sección 5 solo avisa), añadir `RETIRED_KEYS = ['JWT_SECRET', 'JWT_EXPIRATION', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']`.
   - Para cada entorno: leer `environments/<env>/terraform.tfvars.example` si existe (**nunca `terraform.tfvars`**); buscar `new RegExp('^\\s*#?\\s*(' + RETIRED_KEYS.join('|') + ')\\s*=', 'm')` sobre el texto sin recortar, así detecta también la clave comentada; si coincide, `problems.push` con `${file}: contiene la clave retirada ${key} (corte único a Cognito, S18); no debe volver a las plantillas`, mostrando solo el nombre. No tocar `INJECTED_KEYS`, la lectura de `required` ni `KNOWN_DEBT`. Escribir la expresión regular con el editor, no con `cat <<EOF`.
   - Comprobación (provocar el fallo y restaurar por hash, sin `git restore` ni `stash`): guardar una copia de la plantilla de dev en el scratchpad y anotar su SHA-256; añadir `JWT_SECRET = "CHANGE_ME"` dentro de `app_env_vars`; `node scripts/quality-check.mjs` debe salir con código 1 y citar archivo y clave; restaurar copiando la copia encima y comprobar el SHA-256; repetir con la plantilla de prod y con `ADMIN_USERNAME` comentada; ejecutar sin cambios y confirmar código 0.
   - Norma: `mantenimiento.md` (scripts); «los fallos de la puerta de calidad se corrigen, no se silencian».
5. **Verificación global del código (sin editar)**
   - En este orden: `terraform fmt -check -recursive`; `terraform validate` en dev y prod; `node scripts/quality-check.mjs`; `grep` de las cuatro claves en `*.tf`, `*.example` y `scripts/` (debe quedar solo `RETIRED_KEYS` en `quality-check.mjs`). Los avisos de coherencia con `validateEnv.js` son esperados mientras el backend no cambie: el developer los reporta y no los silencia.

## A cargo del tester-documentador

Todo va en el mismo commit que el código. Si `docs-check` falla por claves, es porque no se hizo el paso 1.

1. `docs/referencia-modulos.md` (sección `app_env_vars`): tabla sin las filas de las cuatro claves; prosa («el único secreto de app_env_vars en dev es EMAIL_PASSWORD», `validation` con seis claves obligatorias —cinco de la tabla más `COGNITO_USER_POOL_ID`—, párrafo de prod del paso 3, sin cifras con dígito); la fila de `COGNITO_USER_POOL_ID` en «Claves inyectadas por Terraform» no cambia hasta que el backend la exija; revisar el ejemplo de `tfvars` y el bloque de variables del módulo Beanstalk (texto largo, ~línea 45).
2. `docs/integracion/para-backend.md`: resumen con infra:S6 e infra:S18 en «dev hecho, prod abierto» (infra:C16 sin cambios); sección 2 con la tabla de contrato sin las cuatro claves, reglas de valor sin `JWT_*` ni `ADMIN_PASSWORD`, nota de que siguen siendo válidas como extras en prod y aviso S6 (queda `EMAIL_PASSWORD`); tarea del backend (retirar `POST /log`, `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` de `validateEnv.js` y el verificador HS256; verificador Cognito único; añadir `COGNITO_USER_POOL_ID` a `required`, y entonces la fila pasa a «Sí» y `docs-check` lo avisará); «Orden de despliegue del login» reescrito como orden del corte en dev:
   1. el backend solo-Cognito debe existir y estar listo (**por confirmar**, hoy no existe);
   2. `apply` de infra sin las cuatro claves (si el backend desplegado las exige, no arranca);
   3. despliegue inmediato del backend solo-Cognito (caída de unos minutos aceptada);
   4. después, crear los dos administradores y verificar el TOTP;
   5. después, el frontend.
   Entre pasos, solo lectura: Green en Beanstalk (`describe-environments`, `describe-events`), `/healthcheck` en 200, Hosted UI cargando, estado `CONFIRMED` y MFA de ambos administradores. Sin vuelta atrás en dev (se arregla hacia delante). Condición propia de prod: TOTP verificado en prod con los dos administradores; su vuelta atrás sin decidir (se define en S18-prod). Retirar «convivencia durante la transición» (punto 6 de la lista de verificación) y la línea de fecha/commit.
3. `docs/integracion/para-frontend.md`: el login es un reemplazo sin convivencia de tokens; el login antiguo muere al desplegar el backend; el frontend se despliega después del backend; quitar menciones a la transición y al plazo.
4. `docs/guias/seguridad.md`: SEG-2 y SEG-3 (~líneas 15, 32, 33, 39) y la línea del login antiguo (~112); tabla de estado (~142): `EMAIL_PASSWORD` único secreto en dev, prod conserva los cuatro hasta su corte; renombrar «S6 reabierto» a «casi cerrado en dev; abierto en prod».
5. `docs/estado-y-deuda-tecnica.md`: «Última actualización» con la fecha de hoy; métrica de claves a 7 (contrastar el resto con `--metrics`); S2 (`JWT_SECRET` y `ADMIN_PASSWORD` dejan de estar en dev; rotación y versiones antiguas siguen abiertas); S6 casi cerrado en dev, abierto en prod; S18 parcial (hecho en dev, abierto en prod con la condición del TOTP; **por confirmar** lo que depende del `apply` y del backend); C16 sin cambios; id nuevo solo si procede (p. ej. S18-prod); dejar como histórico la línea de C5.
6. `README.md` (~líneas 43, 86, 110, 157, 158, 192): texto de secretos y de `app_env_vars` de dev y prod; quitar o reformular solo para prod «JWT_SECRET debe ser distinto en dev y prod»; fila de las specs con la spec nueva, plan y aviso; explicar por qué las plantillas de los dos entornos divergen del `tfvars` real de prod.
7. `docs/guias/mantenimiento.md` (~líneas 94, 143 y la fila de `app_env_vars`): lista de claves actualizada y descripción de la regla nueva de `quality-check`.
8. `docs/guias/buenas-practicas-terraform.md` (BP-2 y BP-12, ~línea 25): quitar las cuatro claves de los ejemplos si aparecen.
9. Diagramas: `docs/diagramas/arquitectura-dev.html` (~línea 208): la nota de transición pasa a «login solo por Cognito»; `arquitectura-prod.html` (~línea 191): la nota se queda, porque el login antiguo sigue vivo en prod hasta su corte.
10. Aviso de PR `docs/specs/2026-10-31-cognito-corte-unico-aviso-pr.md` con la sección «Frontend y backend»: qué hace cada repositorio y en qué orden (infra y backend seguidos, luego administradores y TOTP, luego frontend); la caída de dev de unos minutos; que el backend solo-Cognito debe existir antes del `apply`; prod sin tocar; S6 casi cerrado en dev; solo nombres de claves; nota de que `docs-check --strict` y los avisos de coherencia no se limpian hasta que el backend cambie.
11. Specs cerradas anteriores: no se reescriben. Añadir una línea `Nota:` bajo la cabecera de `cognito-login-design.md` y `cognito-login-plan.md` («Modificado por [corte único](2026-10-31-cognito-corte-unico-design.md): decisiones 1, 5 y 10»); las `secretos-beanstalk-*` ya constan como revertidas. Verificar el resultado de `docs-check` tras añadirlo.

## Decisiones de la puerta (03/11/2026)

1. **Plantilla de prod:** comentario de aviso sin nombrar claves (paso 3). No se dejan las cuatro claves en la plantilla.
2. **Fecha** de «Última actualización»: la de hoy, 03/11/2026.
3. **Criterio 4 de la spec:** se verifica `docs-check` sin `--strict`; el estricto queda **por confirmar** hasta que cambie el backend.
4. **Nota «Modificado por»** solo en `cognito-login-design.md` y `cognito-login-plan.md`.
5. **Aviso de PR (segunda opinión):** debe incluir el riesgo de `AllAtOnce` en dev (`modules/beanstalk/main.tf`): el `apply` reinicia con el backend viejo, que exige las cuatro claves y no arranca; Beanstalk podría marcar la actualización como fallida y revertir, o el `apply` tardar. Mitigación: subir antes a S3 la versión del backend nuevo, desplegarla justo tras el `apply`, y comprobar con `describe-events` si hubo rollback. El `apply` de dev debe ser el que crea el pool, para que `COGNITO_USER_POOL_ID` esté disponible al backend nuevo.
6. **`para-frontend.md`** no contiene ninguna de las cuatro claves: el tester debe reformular la parte de la transición a mano, sin apoyarse en el `grep`. Tras el cambio, `modules/beanstalk/variables.tf` debe quedar en 0 coincidencias de las cuatro claves.

## Pruebas

- No hay base de tests para `scripts/`: la prueba del paso 4 es la provocación manual con restauración por SHA-256. Si no se toca `plugins/`, no hace falta `node --test`.
- Cierre del tester, en este orden: `terraform fmt -check -recursive`; `terraform validate` en dev y prod; `node scripts/quality-check.mjs`; `node scripts/docs-check.mjs` y `--metrics`; `node plugins/ciclo-agentico/scripts/docs-gate.mjs`.

## Cierre

- **Crítico: sí.** Entradas de `criticidad`: «secretos y terraform.tfvars», «contrato con el frontend y el backend (VITE_*, build_spec, app_env_vars)» y, por la caída de dev y el reinicio de Beanstalk, «destrucción o reemplazo de recursos» (la más débil: el cambio no reemplaza recursos).
- Documentos de integración afectados: `para-backend.md` (alto) y `para-frontend.md` (medio).

## Riesgos

1. **Caída de dev si el orden falla.** Si infra se aplica antes de que exista el backend solo-Cognito, el backend actual exige las cuatro claves y no arranca. No hay vuelta atrás en dev por decisión del usuario.
2. **El backend solo-Cognito no existe.** Hoy `validateEnv.js`, `routes/auth.js` y `middleware/tokenAuthentication.js` siguen siendo el login antiguo. Los criterios 4 y 6 de la spec dependen de ese repositorio.
3. **Avisos de coherencia y `--strict`.** Hasta que el backend cambie, `quality-check` y `docs-check` darán avisos y `docs-check --strict` fallará. La CI no usa `--strict`.
4. **Claves antiguas en prod.** Siguen en el `tfvars` real y en el estado (S2/S6 sin cerrar). La regla de `quality-check` solo vigila las plantillas, no el `tfvars` real.
5. **Tokens antiguos invalidados.** Los emitidos con el login antiguo dejan de valer al desplegar el backend; según la spec no hay datos que dependan de ellos.

## Preguntas abiertas para la puerta

1. **Fecha de «Última actualización»:** la spec fija 31/10/2026 pero hoy es 03/11/2026. Propuesta: la fecha de hoy (`CLAUDE.md`).
2. **Criterio 4 con `--strict`:** no puede pasar con el backend actual. Propuesta: verificar `docs-check` sin `--strict` y dejar el estricto **por confirmar** hasta que el backend cambie.
3. **Nota «modificado por»** en las specs cerradas: solo en `cognito-login-design.md` y `cognito-login-plan.md`.
