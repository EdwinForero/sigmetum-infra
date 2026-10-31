---
name: refresh-estado
description: Paso 0 del ciclo. Resume en 15 líneas como máximo el estado del repositorio (rama, cambios sin commitear, documento de estado, specs abiertas, grafo de código) leyendo git y los documentos, sin memoria y sin escribir nada.
---

# Refresh de estado

Solo lectura: esta skill no escribe nada en el repositorio, tampoco el grafo de Understand-Anything.

1. Lee `.claude/flujo.json`. Si no existe o no se puede leer, dilo y remite a `/ciclo-init`; el resto del resumen se hace igual con git.
2. Ejecuta `git status --short --branch` y `git log -10 --oneline`.
3. Lee el documento `estado`: la fecha que captura `estadoFecha` y los hallazgos que sigan abiertos (los que no estén en una sección de resueltos).
4. Lista los archivos de `specsDir`. Excluye los archivos que coincidan con `avisoPR`: no llevan `Estado:`. Del resto, están **abiertos** los que no tienen la línea `Estado: cerrado` en su cabecera. Los que la tienen pero están modificados o sin seguimiento en git se muestran como "cerrada, pendiente de commit", no como abiertos.
5. Understand-Anything, solo si sus skills están disponibles en esta sesión: la carpeta del grafo se determina como lo hace ese plugin: `.understand-anything/` si existe; si no, `.ua/` si existe; si no existe ninguna, el primer grafo irá a `.ua/`. Su `meta.json` guarda el commit analizado. Compáralo con `git rev-parse HEAD` e informa de si está al día, desactualizado o no existe. No lo actualizas ni lo creas: lo hace el orquestador en el último punto del paso 0, si se cumplen sus condiciones. Nunca se usa `--auto-update`: instala hooks que actualizan el grafo sin pedir confirmación.

## Entrega (máximo 15 líneas)

1. Rama y último commit.
2. Cambios sin commitear: si los hay, lista corta y el aviso "hay cambios sin commit: el ciclo se detendrá para elegir entre hacer commit, abandonar o declarar continuación".
3. Fecha del documento `estado` y hallazgos abiertos (máximo 5, los más relevantes).
4. Specs y planes abiertos en `specsDir`, y los cerrados pendientes de commit.
5. Grafo de Understand-Anything: al día, desactualizado, inexistente o no disponible.
