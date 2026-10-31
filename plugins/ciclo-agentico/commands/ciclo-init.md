---
description: Prepara el proyecto actual para /ciclo creando o validando .claude/flujo.json, los permisos de settings.json y la sección de CLAUDE.md, sin hacer commit.
---

# /ciclo-init

Preparas el proyecto para `/ciclo`. Este comando no hace commit, ni push, ni `git add`: deja los archivos en el árbol de trabajo y el usuario decide. `<plugin>` es la carpeta de este plugin. Búscala en este orden: `${CLAUDE_PLUGIN_ROOT}` **(por confirmar que se sustituye en comandos)**; la carpeta padre de `plugins/ciclo-agentico/scripts` bajo el directorio actual; y `~/.claude/plugins/cache` con `Glob` `**/ciclo-agentico/**/scripts/docs-gate.mjs`. Si no aparece, para y dilo. Antes de escribir cualquier archivo, muestra qué vas a escribir y pide confirmación con `AskUserQuestion`.

## 1. Dependencias

Antes de decidir nada que dependa de los plugins instalados, ejecuta `node "<plugin>/scripts/bootstrap-agentes.mjs" --dry-run` e informa de lo que falta (sin `flujo.json` usa solo el perfil `base` y lo avisa). Las líneas `- <id> [<rol>]` son faltantes; las `Omitido:`, plugins que no aplican en este sistema. Las líneas `- <id> [local]` son plugins locales del marketplace del proyecto aún no instalados (campo `marketplaceLocal`): infórmalos todos en una sola línea, remite a `npm run agentes:bootstrap` (o al script sin `--dry-run` si el proyecto no tiene ese script npm) y sigue; no bloquean. Para instalar lo que falte, el usuario ejecuta el script sin `--dry-run` en su terminal: pide confirmación por cada plugin y tu `Bash` no es interactivo.

## 2. `.claude/flujo.json`

- **Si ya existe**, no lo sobrescribas: valídalo con `node "<plugin>/scripts/docs-gate.mjs" --solo-validar`, muestra los problemas y propón los cambios (con confirmación antes de aplicarlos).
- **Si no existe**, créalo desde `<plugin>/templates/flujo.json` (sin la clave `$comentario`), preguntando cada grupo de valores con `AskUserQuestion` y proponiendo lo que detectes:
  1. `guias`, `integracion`, `estado` y `docsRegla`: busca carpetas como `docs/`, guías o normas, un documento de estado o deuda, y documentos de contrato con otros repositorios. Para `estadoFecha`, propón una expresión con un único grupo de captura que encuentre la fecha DD/MM/AAAA en el documento de estado.
  2. `verificacion`: propón los scripts de lint, análisis y pruebas que encuentres en el gestor de paquetes del proyecto (por ejemplo, `package.json`). Las pruebas van en la clave `test`; omítela si el proyecto no tiene una base de tests real (un marcador que solo imprime un aviso no cuenta), porque el developer aplica TDD solo cuando existe. Debe haber una entrada que invoque `docs-gate.mjs`; es preferible un script del proyecto que lo envuelva, porque la ruta del plugin cambia entre equipos **(por confirmar)**.
  3. `specsDir`, `docsObligatorios` (al menos el documento `estado`), `docsPorArea`, `areasContrato` y `avisoPR`: propón un mapa de carpetas de código a documentos a partir de la estructura del repositorio.
  4. `criticidad`, `perfiles`, `consultor` y `estilo` según la salida del paso 1 (`ninguno` si el plugin correspondiente falta o salió como `Omitido:`), y `maxVueltas` (3 por defecto).
  5. `skillsProyecto` y `marketplaceLocal`: los valores de la plantilla son de ejemplo y no valen para un proyecto nuevo; no los copies. Para `skillsProyecto`, propón las carpetas `skills/` del propio proyecto que encuentres (con `Glob` `**/skills/*/SKILL.md`, fuera de dependencias y de la carpeta de este plugin) y omite la clave si no hay ninguna. `marketplaceLocal` es opcional: es la ruta relativa, con `/`, a la carpeta que contiene `.claude-plugin/marketplace.json` de un marketplace local del proyecto (búscalo con `Glob` `**/.claude-plugin/marketplace.json`); si el proyecto no tiene marketplace local, omite la clave.
- Al terminar, valida con `node "<plugin>/scripts/docs-gate.mjs" --solo-validar` hasta que salga con 0.

## 3. `.claude/settings.json`

Lee el archivo (o parte de `{}` si no existe) y fusiona `<plugin>/templates/settings-snippet.json` sin sobrescribir nada:

- Añade a `permissions.ask` las entradas que falten, sin duplicar ni quitar las existentes.
- Añade `"autoMemoryEnabled": false` si no está. Si está con otro valor, pregunta antes de cambiarlo.
- Muestra el diff y pide confirmación antes de escribir.

## 4. `CLAUDE.md`

Si no contiene ya el encabezado de `<plugin>/templates/CLAUDE-seccion.md`, propón añadir esa sección al final (o crear el archivo con ella) y pide confirmación.

## 5. `.gitignore`

Si no contiene `.understand-anything/` y `.ua/` (el grafo de Understand-Anything es derivado y regenerable), propón añadirlos y pide confirmación.

## Entrega

1. Archivos creados o modificados, y los que se dejaron sin tocar.
2. Resultado de `--solo-validar`.
3. Dependencias que faltan (paso 1).
4. Siguiente paso: revisar los cambios y hacer su commit, que es necesario antes del primer `/ciclo` (`/ciclo` se detiene si el árbol tiene cambios sin commit). El commit lo hace el usuario: `/ciclo-init` no hace commit. Después, lanzar `/ciclo <tarea>`.
