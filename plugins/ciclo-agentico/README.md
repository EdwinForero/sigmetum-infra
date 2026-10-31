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
