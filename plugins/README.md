# Plugins locales (marketplace `locales-infra`)

Esta carpeta es un marketplace local de Claude Code: `.claude-plugin/marketplace.json` declara, con el nombre `locales-infra`, los plugins hermanos que viven aquí. Cada plugin es una carpeta con su `.claude-plugin/plugin.json` y sus `skills/<nombre>/SKILL.md`. Es el **único** documento que nombra las skills del proyecto y dice dónde están; el resto de la documentación enlaza aquí.

Las skills son el procedimiento paso a paso; las normas y su motivo están en las guías (`docs/guias/`, las `guias` de `.claude/flujo.json`). Se usan juntas. **Ninguna skill ni rol ejecuta `terraform apply`, `destroy` ni `plan`.**

## Plugins y skills

| Plugin | Perfil (tag) | Skills | Cuándo se usa |
|---|---|---|---|
| [`ciclo-agentico`](ciclo-agentico/README.md) | `base` | `principios`, `refresh-estado` (más los comandos `/ciclo` y `/ciclo-init` y los cuatro roles) | Núcleo portable del flujo agéntico |
| `terraform-general` | `terraform` | `tf-module-change`, `tf-variable-output-change`, `contract-change-review`, `pre-apply-checklist` | **Generales**: al cambiar un módulo; una variable, un output o `app_env_vars`; algo del contrato con el frontend o el backend; y al preparar un apply |
| `dominio-aws` | `aws` | `iam-s3-review`, `amplify-change` | **Específicas** del dominio AWS: al tocar IAM, S3, secretos, red o TLS; y al tocar Amplify |

Las skills remiten entre sí cuando hace falta (por ejemplo, `tf-module-change` pide `contract-change-review` si el módulo toca el contrato).

## Cómo se activan

Cada entrada del marketplace lleva un tag `perfil:<x>`. Los `perfiles` de `.claude/flujo.json` (`base`, `terraform`, `aws`) deciden qué plugins aplican al proyecto, y `marketplaceLocal` apunta a esta carpeta (`"plugins"`). `skillsProyecto` lista las carpetas `skills/` de los plugins de dominio para que los roles las consulten.

Este repositorio no tiene `package.json`, así que el bootstrap se ejecuta directamente (`--dry-run` solo informa):

```
node plugins/ciclo-agentico/scripts/bootstrap-agentes.mjs --dry-run
```

A mano:

```
claude plugin marketplace add ./plugins
claude plugin install terraform-general@locales-infra
claude plugin install dominio-aws@locales-infra
```

**Convivencia con el marketplace `locales` del backend:** en el equipo ya puede existir un marketplace de usuario llamado `locales` (con ruta absoluta del backend) que instala `ciclo-agentico`. El código del núcleo es idéntico, así que no hace falta instalar `ciclo-agentico@locales-infra`: dos plugins con el mismo nombre podrían chocar **(por confirmar)**. Se instalan de `locales-infra` solo los plugins de dominio. Los de `locales` también se cargan en este repositorio.

**(por confirmar)** que `claude plugin marketplace add ./plugins` funcione aquí y que Claude Code exija el prefijo `/ciclo-agentico:ciclo`.

Si editas un plugin que ya está instalado, lee [Tras cambiar un plugin local](#tras-cambiar-un-plugin-local).

## Tras cambiar un plugin local

Claude Code ejecuta los comandos, agentes y skills de un plugin instalado desde su copia en la caché (`~/.claude/plugins/cache`), no desde esta carpeta: un cambio aquí no llega a la sesión hasta que se actualiza el plugin.

1. Si el cambio altera el comportamiento, sube `version` en el `.claude-plugin/plugin.json` del plugin y, en el núcleo, añade la entrada en `ciclo-agentico/CHANGELOG.md` (y ajusta la versión que fija `ciclo-agentico/tests/manifiestos.test.mjs`).
2. Actualiza o reinstala el plugin: `claude plugin marketplace update locales-infra` y después `claude plugin update <plugin>@locales-infra`, o `claude plugin uninstall <plugin>@locales-infra` y `claude plugin install <plugin>@locales-infra` **(por confirmar: que `update` recoja los cambios de un marketplace local sin subir la versión)**.
3. Reinicia la sesión de Claude Code (o ejecuta `/reload-plugins`) para que cargue la copia nueva.
4. Comprueba el plugin con la [verificación manual](ciclo-agentico/README.md#modelos-y-esfuerzo-por-rol) (`claude plugin validate plugins/ciclo-agentico --strict` y `claude --debug`).

Los scripts que se ejecutan como entradas de `verificacion` de `.claude/flujo.json` (por ejemplo, `node plugins/ciclo-agentico/scripts/docs-gate.mjs`) usan la copia del repositorio, así que ven el cambio sin reinstalar nada.

## Añadir una categoría nueva

1. Crea `plugins/<nombre>/` con `.claude-plugin/plugin.json` (`name`, `version`, `description`, `author`) y `skills/<nombre>/SKILL.md` (con `name` igual a la carpeta y una `description` que diga cuándo usarla). Las skills no pueden ir anidadas en subcarpetas de `skills/`: la categoría es el plugin.
2. Añade su entrada a `.claude-plugin/marketplace.json` con `source: "./<nombre>"` y `tags: ["perfil:<x>"]`.
3. Añade el perfil a `perfiles` y la carpeta `skills/` a `skillsProyecto` en `.claude/flujo.json`.
4. Añade la fila a la tabla de este documento.
5. Comprueba con `node plugins/ciclo-agentico/scripts/docs-gate.mjs --solo-validar` y `node --test "plugins/**/tests/**/*.test.mjs"`.

## Sacar el núcleo a otro repositorio

`ciclo-agentico` no depende de nada de esta carpeta ni del proyecto. Para usarlo en otro repositorio, copia la carpeta `ciclo-agentico/` y crea allí su marketplace. Las pruebas de `tests/` de esta carpeta son del marketplace y de las skills del proyecto; las del núcleo viajan con él en `ciclo-agentico/tests/`.

## Alcance de las comprobaciones

`scripts/quality-check.mjs` y `scripts/docs-check.mjs` **no escanean `plugins/`** (solo `docs/`, los `.tf`, las plantillas de `environments/` y `scripts/`). Los secretos y los enlaces de esta carpeta se revisan a mano y con las pruebas de `plugins/`.
