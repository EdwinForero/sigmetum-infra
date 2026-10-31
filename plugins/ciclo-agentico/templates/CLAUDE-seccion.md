## Ciclo de desarrollo (ciclo-agentico)

Toda feature o fix pasa por `/ciclo <tarea>`. La configuración del proyecto está en `.claude/flujo.json` (se crea y se valida con `/ciclo-init`).

Fases: 0 refresh de estado · 1 requisitos → puerta humana · 2 arquitectura → puerta humana · 3 desarrollo · 4 verificación y documentación (vuelve a 3 si falla, hasta `maxVueltas`) · 5 puerta humana final.

Roles y límites:

- `requirements`: lee y escribe solo el borrador de spec en `specsDir`; no propone solución técnica.
- `architect`: solo lee; entrega un plan por pasos contrastado con `guias` e `integracion`, o un veto motivado.
- `developer`: edita código y pruebas siguiendo el plan, con TDD si hay base de tests; no edita documentos.
- `tester-documentador`: ejecuta `verificacion`, pone los documentos al día y propone el mensaje de commit; no edita código.

Principios de trabajo: skill `principios` del plugin (fuente única; no se copian aquí).

Cierre documental obligatorio: ninguna iteración termina sin el documento `estado` al día y `docs-gate` en verde.

Nadie del ciclo hace commit, push ni `git add`: el commit lo hace el usuario tras la puerta final.
