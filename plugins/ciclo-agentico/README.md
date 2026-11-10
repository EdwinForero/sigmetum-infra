# ciclo-agentico

Plugin de Claude Code que organiza el desarrollo con agentes en un ciclo con roles y puertas de aprobación.

## Instalación

El plugin no trae marketplace propio: lo aporta el repositorio que lo aloja. En un repositorio con un marketplace local en `plugins/` (nombre `locales`):

```
claude plugin marketplace add ./plugins
claude plugin install ciclo-agentico@locales
```

Verificado el 28/10/2026 en Windows (ver [plugins/README.md](../README.md)). Para llevarlo a otro repositorio basta con copiar esta carpeta y declararla en el marketplace de allí.

## Comandos

- `/ciclo-init`: crea o valida `.claude/flujo.json`, fusiona los permisos de `templates/settings-snippet.json` y añade la sección de `templates/CLAUDE-seccion.md`. No hace commit.
- `/ciclo <tarea>`: ejecuta el ciclo completo (refresh, requisitos, arquitectura, desarrollo, verificación y documentación) con puerta humana entre fases.

Nota: puede que Claude Code exija el prefijo del plugin (`/ciclo-agentico:ciclo`, `/ciclo-agentico:ciclo-init`) **(por confirmar)**.

## Roles

Los cuatro roles (`agents/`) precargan la skill `principios`, que contiene los principios de trabajo y el contrato de salida común; cada rol solo añade qué es su resultado. Las reglas de git (no commit, no push, no `git add`, ni `stash`, `checkout`, `restore`, `reset` o `clean`) se repiten a propósito en la sección Límites de cada rol: son de seguridad y no deben depender de que la precarga de la skill funcione.

## Modelos y esfuerzo por rol

Cada rol fija su `model` y su `effort` en el frontmatter de `agents/`:

| Rol | `model` | `effort` |
|---|---|---|
| `requirements` | sonnet | medium |
| `architect` | opus | high |
| `developer` | sonnet | medium |
| `tester-documentador` | sonnet | medium |
| Segunda opinión y revisión por escalado | opus (en la llamada) | high (en la llamada) |

`/ciclo` no pasa `model` ni `effort` al lanzar los cuatro roles: manda el frontmatter. Solo la segunda opinión (cuando la pide el orquestador con `Agent`) y la revisión por escalado los fijan en la propia llamada; no se guardan en ningún archivo.

**Precedencia.** `model`: parámetro de `Agent` > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > modelo de la sesión. `effort`: `CLAUDE_CODE_EFFORT_LEVEL` > parámetro de `Agent` > frontmatter > esfuerzo de la sesión.

**Variables que anulan la tabla.** `CLAUDE_CODE_SUBAGENT_MODEL` y `CLAUDE_CODE_EFFORT_LEVEL`, si están definidas, anulan la tabla (según la precedencia de arriba). El paso 0 de `/ciclo` lo avisa con una línea («la tabla de modelos está anulada por <nombre de la variable>») sin imprimir ni pedir su valor, y no bloquea. Límite: si la variable solo está en el `env` de `settings.json`, puede que `Bash` no la vea y el aviso no salga **(por confirmar)**.

**Fallo repetido.** El `developer` «falla lo mismo» cuando, en dos vueltas consecutivas, (a) el texto de la devolución del tester es el mismo (salvo espacios y saltos de línea sobrantes) o (b) el mismo comando de verificación falla con la misma línea clave. Entonces `/ciclo` no relanza al `developer` sin más: pide una revisión con opus y esfuerzo alto, pasándole el diff y el fallo. La revisión cuenta como una vuelta y respeta `maxVueltas`; solo informa (no corrige ni hace commit) y sus conclusiones van como devolución en la vuelta siguiente. Si el `developer` vuelve a fallar tras la revisión, se escala al usuario con el diff y el fallo. Con `maxVueltas` en 3, el fallo repetido solo se detecta al acabar la vuelta 2 y la revisión sube el contador al tope, así que el usuario decide siempre tras la revisión. Límite: un mismo fallo redactado de otra forma puede no detectarse; `maxVueltas` es la red de seguridad.

**Qué medir.** Sin cambiar el flujo, leyendo la puerta final: vueltas por ciclo, devoluciones del tester y hallazgos de la segunda opinión. Aún no hay medición real.

**Verificación manual (la hace el usuario, no los roles).**

1. `claude plugin validate plugins/ciclo-agentico --strict`.
2. `claude --debug` y buscar «does not recognize or apply» en la salida.
3. Tras cambiar el plugin, `/reload-plugins` o una sesión nueva.

Por confirmar: que `validate --strict` avise de un campo desconocido dentro de un agente (puede no avisar), y que `medium` y `high` sean válidos para sonnet y opus.

**Riesgo.** Las copias del núcleo en otros repositorios (y sus cachés) siguen en 0.1.0 hasta que se copie el núcleo de nuevo; queda fuera de este cambio.

**Atribución.** La idea y la tabla se inspiran en [ai-routing](https://github.com/donimas/ai-routing) (MIT); no se copian sus plantillas, su hook ni su `settings.json`.

## Dependencias

El catálogo está en `.claude-plugin/dependencias.json`. Para comprobarlo o instalar lo que falte:

```
node scripts/bootstrap-agentes.mjs --dry-run   # solo informa
node scripts/bootstrap-agentes.mjs             # pregunta antes de instalar cada plugin
```

El script lee `claude plugin list --json`; si el CLI es antiguo y no da JSON, cae a la salida de texto. Si un plugin instalado tiene una versión distinta de la revisada en el catálogo, lo avisa sin bloquear.

Si `.claude/flujo.json` tiene el campo opcional `marketplaceLocal` (ruta relativa con `/` a la carpeta de un marketplace local, dentro del proyecto: sin segmentos `..`, sin `/` inicial ni letra de unidad), el script también lista los plugins de ese marketplace cuyo tag `perfil:<x>` corresponde a algún perfil activo y no están instalados (`- <id> [local]` en `--dry-run`); sin `--dry-run` pregunta, ejecuta una vez `claude plugin marketplace add ./<marketplaceLocal>` desde la raíz del proyecto, `claude plugin install <plugin>@<marketplace>` por cada uno y vuelve a comprobar. Un plugin local sin instalar no cambia el código de salida.

Códigos de salida: 0 todo correcto (o solo se rechazaron opcionales), 1 queda sin instalar una dependencia de rol `base`, 2 no se pudo comprobar: no existe `claude`, `claude plugin list` falla (también al verificar tras instalar) o el catálogo `dependencias.json` está roto o no es válido.

## Cierre documental

`scripts/docs-gate.mjs` comprueba, contra `.claude/flujo.json`, que se tocaron los documentos obligatorios y los de cada área, que la fecha del documento `estado` es la de hoy y, si se tocó un área de contrato, que hay aviso para PR y que cambió un documento de `integracion` o el aviso tiene una línea que empieza por `Integración: sin impacto — ` seguida del motivo. `--solo-validar` solo valida `flujo.json`.

`awesome-design-md` no es un plugin: es un repositorio de ficheros `DESIGN.md` que se copian a mano en el proyecto, por eso no está en el catálogo.
