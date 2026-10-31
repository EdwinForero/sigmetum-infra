---
description: Ejecuta una tarea con el ciclo de cuatro roles (requisitos, arquitectura, desarrollo, verificación y documentación), con puerta humana entre fases y sin commits.
argument-hint: <tarea>
---

# /ciclo

Tarea: $ARGUMENTS (si está vacía, pídela con `AskUserQuestion`).

Corres en la conversación principal: lanzas los roles con `Agent` (`requirements`, `architect`, `developer`, `tester-documentador`; puede hacer falta el prefijo `ciclo-agentico:` **(por confirmar)**), preguntas con `AskUserQuestion` y ejecutas comandos con `Bash`. Lo que cada rol hace y entrega está en su definición: aquí solo se decide el orden y qué hacer con cada entrega. Los traspasos son archivos en `specsDir`: a cada rol le pasas rutas, no resúmenes.

## Reglas del orquestador

- El orquestador nunca hace commit, push ni `git add`, ni siquiera tras la aprobación final. Tampoco `git stash`, `checkout`, `restore`, `reset` ni `clean`.
- `<plugin>` es la carpeta de este plugin. Búscala en este orden: `${CLAUDE_PLUGIN_ROOT}` **(por confirmar que se sustituye en comandos)**; la carpeta padre de `plugins/ciclo-agentico/scripts` bajo el directorio actual; y `~/.claude/plugins/cache` con `Glob` `**/ciclo-agentico/**/scripts/docs-gate.mjs`. Si no aparece, para y dilo.
- **Puerta humana**: un bloque fijo con **Fase**, **Resultado**, **Decisión pendiente**, **Riesgos** y **Segunda opinión** (o "ninguna"), y después `AskUserQuestion` con Aprobar / Pedir cambios / Abandonar (salvo que el paso indique otras opciones). Abandonar termina el ciclo: los cambios quedan en el árbol de trabajo, sin commit y sin declarar nada cerrado.
- **Escalar**: mostrar fase, qué falla (comando y línea clave) y preguntar con `AskUserQuestion` entre las opciones que indique el paso; esperas la respuesta.
- Nunca presentas la puerta final con verificación en rojo, excepto fallos preexistentes que el usuario haya aceptado explícitamente cuando se los escalaste; esos van a Riesgos. El cierre documental (`docs-gate` y demás entradas de documentación) no admite excepciones.
- **Disponible**: las skills de ese plugin aparecen en esta sesión y el paso 0 no lo dio como faltante ni omitido.
- **Estilo**: con `estilo: i-have-adhd`, añade a cada prompt de rol "Aplica tu contrato de salida" y, si la skill `i-have-adhd` está disponible (nombre de skill **por confirmar**), invócala para tus propios mensajes. Con `estilo: ninguno` no haces nada especial: el contrato ya llega a cada rol por la skill `principios`.
- **Crítico**: el architect devolvió `crítico: sí` (su plan se compara con `criticidad`). Si devolvió `no determinable` (por ejemplo, falta `criticidad`), pregunta al usuario si se trata como crítico.
- **Segunda opinión** (solo si es crítico, sobre el plan y sobre el diff):
  - Con `consultor: octopus` y Octopus disponible: `/octo:review` **(por confirmar el comando en un equipo donde funcione, y que `/octo:review` acepte un plan, que no es un diff)**.
  - Con `consultor: ninguno` o sin Octopus: la skill `superpowers:requesting-code-review`, adaptada. Para el plan, se revisa el archivo del plan. Para el diff, `git diff HEAD` más los archivos sin seguimiento (`git ls-files --others --exclude-standard`), que nombras en la petición; no `HEAD~1..HEAD`, que revisaría otro commit.
  - Solo informa: no se corrige nada (tampoco lo que marque como "Critical") y no se hace commit. El resultado se muestra en la puerta como segunda opinión y riesgo: nunca bloquea ni aprueba por sí solo.

## Paso 0: refresh y comprobaciones

Hasta el punto 5 el ciclo no escribe nada en el repositorio: la comprobación de árbol limpio va antes de cualquier escritura.

1. Valida la configuración: `node "<plugin>/scripts/docs-gate.mjs" --solo-validar`. Si no sale con 0, muestra los mensajes y para: hay que ejecutar `/ciclo-init`. `requirements` y `architect` no tienen Bash y dependen de esta validación. Para también, remitiendo a `/ciclo-init`, si ninguna entrada de `verificacion` invoca `docs-gate.mjs` (directamente o mediante un script que lo envuelva: léelo).
2. Dependencias: `node "<plugin>/scripts/bootstrap-agentes.mjs" --dry-run` (sale con 0 aunque falten; lee la salida). Las líneas `- <id> [<rol>]` son faltantes; las `Omitido:`, plugins que no aplican en este sistema.
   - Falta una de rol `[base]`, o el script sale con 2 y las skills de Superpowers no están disponibles: para y ofrece instalarla. El script sin `--dry-run` pide confirmación por terminal y tu `Bash` no es interactivo (contaría como "no"), así que pide al usuario que ejecute `node "<plugin>/scripts/bootstrap-agentes.mjs"` en su terminal, reinicie la sesión y vuelva a lanzar `/ciclo`.
   - Faltan complementos o los adaptadores de `consultor` o `estilo`: dilo en una línea y sigue con las alternativas de estas reglas.
   - Las líneas `- <id> [local]` son plugins locales del marketplace del proyecto aún no instalados (campo `marketplaceLocal`): infórmalos todos en una sola línea, remite a `npm run agentes:bootstrap` en la terminal del usuario (o al script sin `--dry-run` si el proyecto no tiene ese script npm) y sigue; no bloquean.
3. Si `git status --porcelain` muestra cambios (lo ignorado no cuenta), para: `docs-gate` compara con `HEAD` y mezclar iteraciones falsea el resultado. Pregunta con `AskUserQuestion`: "Hacer commit yo y relanzar" (recomendada: tú no haces el commit, solo lo pides), "Abandonar" o "Continuación: estos cambios son parte de esta misma iteración" (por ejemplo, se retoma un `/ciclo` interrumpido). Solo con la tercera sigues, y la puerta final dirá que la iteración incluye cambios previos. No tocas esos cambios.
4. Invoca la skill `refresh-estado` (`ciclo-agentico:refresh-estado`), de solo lectura, y muestra su resumen.
5. Grafo de Understand-Anything, solo si está disponible y el refresh lo dio como desactualizado o inexistente. Aplica la regla de carpeta del grafo de `refresh-estado` (su punto 5, cargada en el punto 4). Antes de tocarlo:
   - Si existe una de las dos, debe estar ignorada y sin archivos rastreados: `git check-ignore -q <carpeta>/` sale con 0 y `git ls-files .understand-anything .ua` no devuelve nada. Si no, avisa al usuario de que la añada al `.gitignore` y, si está rastreada, la quite del índice con `git rm -r --cached <carpeta>` (lo hace él), y sigue sin grafo.
   - Si no existe ninguna, deben estar ignoradas las dos: `git check-ignore -q .understand-anything/` y `git check-ignore -q .ua/` salen con 0. Si falta cualquiera, avisa de que hay que ignorar las dos y sigue sin grafo.
   - Si pasa la comprobación: desactualizado, invoca `understand-anything:understand` de forma explícita (nunca con `--auto-update`); inexistente, ofrécelo con `AskUserQuestion` y, antes del primer análisis, comprueba que `.understandignore` excluye entorno, secretos y dependencias.

## Paso 1: requisitos y puerta humana

1. Lanza `requirements` con la tarea y la ruta de la plantilla `<plugin>/templates/spec.md` (con `<plugin>` resuelto), y dile que si ya existe un archivo con ese nombre, añada un sufijo y lo diga. Entrega la ruta del borrador en `specsDir` y hasta 5 preguntas abiertas.
2. Plantea las preguntas al usuario con `AskUserQuestion`: juntas si son independientes, una cada vez si dependen entre sí.
3. Incorpora las respuestas: relanza `requirements` con la ruta del borrador y las respuestas, o edita tú el borrador si basta con copiarlas. Repite 2 y 3 hasta que no queden preguntas o el usuario declare las restantes fuera de alcance.
4. Puerta humana con la spec. Pedir cambios: vuelve a 3 con sus indicaciones. Aprobar: pon `Estado: aprobado` en la cabecera de la spec.

## Paso 2: arquitectura y puerta humana

1. Si `understand-anything:understand-explain` está disponible, ejecútala sobre el módulo que señala la spec y pasa el resultado al architect.
2. Lanza `architect` con la ruta de la spec aprobada y la de la plantilla `<plugin>/templates/plan.md` (con `<plugin>` resuelto).
3. Si su entrega trae preguntas (falta algo en la spec), plantéalas con `AskUserQuestion`, actualiza la spec como en el paso 1, puntos 3 y 4, y relanza `architect`.
4. Veto: puerta humana con el motivo y la regla citada, con las opciones "Revisar requisitos" (vuelve al paso 1, punto 3, con el veto) o "Abandonar"; aquí no hay Aprobar.
5. Plan: si es crítico, pide la segunda opinión sobre el plan. Puerta humana con el plan, la línea `crítico` y la segunda opinión. Pedir cambios: relanza `architect` con las indicaciones y repite este punto.
6. Aprobado: guarda el plan en `<specsDir>/AAAA-MM-DD-<tema>-plan.md` con la estructura de `<plugin>/templates/plan.md`: un solo archivo, con fases de máximo 5 pasos si hay más.

## Paso 3: desarrollo

1. Lanza `developer` con las rutas del plan y la spec y, si vienes de una devolución, su texto literal.
2. Si entrega un paso imposible, ambiguo o contrario a una norma, vuelve al paso 2 con su motivo (nuevo plan, nueva puerta humana).
3. Si `understand-anything:understand-diff` está disponible, ejecútala sobre el diff y guarda el resultado para el tester.

## Paso 4: verificación y documentación

Una vuelta es una pasada del paso 3 al 4; se cuentan desde 1 y el tope es `maxVueltas`.

1. Foto de código, antes: de `git status --porcelain=v1 -z --untracked-files=all`, todo archivo cambiado que no sea documento, cada uno con su `git hash-object` (o "borrado"); así también se vigilan pruebas y scripts nuevos. Es documento: extensión `.md`, `.mdx` o `.txt`; el documento `estado`; los `docsObligatorios`; los valores de `docsPorArea`; los de `integracion` y `guias`; lo que esté bajo `specsDir`; y lo que coincida con `avisoPR`. Límite conocido de la foto: un documento nuevo que no sea `.md`, `.mdx` ni `.txt` y que el tester cree fuera de esas listas aparecerá como cambio de código (falso rojo); se resuelve como en el punto 3.
2. Lanza `tester-documentador` con las rutas de la spec y el plan, indicándole la sección "A cargo del tester-documentador" del plan (pasos de documentación que el developer no hace) y, si lo hay, el resultado de `understand-diff`.
3. Foto de código, después, igual. Si difiere en algo (archivo nuevo, desaparecido u otro hash), la iteración falla porque el tester no puede tocar código de producción: escala con los archivos afectados. Opciones: volver al paso 3 con ese diff como devolución (cuenta como vuelta y respeta el tope del punto 4), que el usuario lo resuelva a mano y repetir el paso 4, o abandonar.
4. Según la entrega del tester:
   - **Devolución al developer**: si la vuelta es menor que `maxVueltas`, vuelve al paso 3 con el texto de la devolución. Si es igual, escala con el estado. Opciones: conceder una vuelta más, volver al paso 2 o abandonar.
   - **Preexistentes**: escálalos aparte con "Aceptar como riesgo" o "Abandonar"; no cuentan como vuelta. Los aceptados van a Riesgos de la puerta final.
   - **Bloqueo de configuración o documentación en rojo** tras sus reintentos: escala. Opciones: el usuario corrige y se repite el paso 4 (sin contar vuelta), volver al paso 2 si el código cambió algo no previsto en el plan, o abandonar.
   - **Verde** (o solo preexistentes aceptados): sigue.
5. Por cada elemento de "Diagramas a regenerar", invoca `diagram-design:diagram-design`; si no está disponible, anótalos en Riesgos.
6. Si es crítico, pide la segunda opinión sobre el diff.
7. Ejecuta tú las entradas de documentación de `verificacion` (las que el tester clasificó así, incluida la de `docs-gate`). Si alguna está en rojo, relanza `tester-documentador` con su proceso completo, envuelto en las mismas fotos de código antes y después (puntos 1 y 3): si cambia código de producción, la iteración falla como en el punto 3. Este relanzamiento no cuenta como vuelta, se hace una sola vez y su entrega se trata como en el punto 4; si la documentación sigue en rojo, escala como allí.

## Paso 5: puerta humana final

Bloque fijo de la puerta humana y, debajo:

1. El "Aviso para PR" (contenido del archivo que coincide con `avisoPR` y que cambió en esta iteración, según `git status`, como hace `docs-gate`) si el cambio tocó `areasContrato`.
2. El mensaje de commit propuesto por el tester. Si hay preexistentes aceptados, el tester no lo propone: muestra "Mensaje de commit: no propuesto por el tester (verificación no totalmente en verde por fallos preexistentes aceptados)" y una sugerencia breve tuya (título de la spec y una nota sobre los preexistentes).
3. Si en el paso 0 se eligió "Continuación", la línea: "la iteración incluye cambios previos".
4. La frase: "El commit lo hace el usuario. El orquestador nunca hace commit, push ni `git add`."

Aprobar: pon `Estado: cerrado` en la spec y el plan (anúncialo en la decisión pendiente) y el ciclo termina. Pedir cambios: vuelve al paso 3 con las indicaciones como devolución, con el contador de vueltas desde 1. Abandonar: termina sin tocar nada más.
