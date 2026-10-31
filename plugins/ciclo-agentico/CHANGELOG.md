# Cambios

## 0.1.0

Primera versión. Contiene:

- **Cuatro roles** (`agents/`): `requirements`, `architect`, `developer` y `tester-documentador`, cada uno con sus límites, su entrega y las particularidades de su contrato de salida.
- **Comandos**: `/ciclo` (orquesta los cuatro roles con puerta humana entre fases, tope de vueltas y sin commits) y `/ciclo-init` (crea o valida `.claude/flujo.json`, fusiona los permisos y añade la sección de `CLAUDE.md`).
- **Skills**: `refresh-estado` (resumen de solo lectura del paso 0) y `principios` (normas comunes y contrato de salida común que precargan los roles).
- **Scripts**: `docs-gate` (cierre documental contra `flujo.json`, incluida la exigencia de integración o de la línea `Integración: sin impacto — <motivo>` cuando se toca un área de contrato) y `bootstrap-agentes` (comprueba e instala con confirmación las dependencias, leyendo `claude plugin list --json`, y los plugins del marketplace local que declare el campo opcional `marketplaceLocal` según sus tags `perfil:<x>`).
- **Plantillas** (`templates/`): `flujo.json`, `settings-snippet.json`, `CLAUDE-seccion.md`, `spec.md` y `plan.md`.
- **Catálogo de dependencias** (`.claude-plugin/dependencias.json`), con versión revisada cuando se conoce, y manifiesto `plugin.json` (sin marketplace propio: lo aporta el repositorio que aloja el plugin).
