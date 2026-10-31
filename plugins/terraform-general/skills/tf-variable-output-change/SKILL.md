---
name: tf-variable-output-change
description: Lista de comprobación para añadir, renombrar o quitar una variable, un output o una clave de app_env_vars. Úsala siempre que cambie un variables.tf, un outputs.tf, app_env_vars o un terraform.tfvars.example.
---

# Cambio de variable, output o clave de `app_env_vars`

Las normas están en `docs/guias/buenas-practicas-terraform.md` (BP-2 y BP-3) y en la lista "Variable, output o clave de `app_env_vars`" de `docs/guias/mantenimiento.md` (sección 6).

1. **Variable**: lleva `type` y `description`, y `validation` si hay valores sin sentido. Un secreto lleva `sensitive = true` (BP-2).
2. **Valor por defecto seguro**: no pongas un valor por defecto que abra algo (por ejemplo, SSH).
3. **Output**: solo lo que consume otro módulo, un entorno o una persona tras el apply. Lleva `description` y, si deriva de un valor sensible, `sensitive = true`. Nunca un secreto (BP-3).
4. **Sin restos**: si renombras o quitas, busca todos los usos del nombre antiguo en módulos y entornos.
5. **Plantillas**: si es obligatoria en un entorno, está en su `terraform.tfvars.example` con un marcador (`CHANGE_ME_...`, `YOUR_...`), nunca con un valor real. No leas ni imprimas el `terraform.tfvars` real: solo nombres de claves.
6. **Clave de `app_env_vars`**: contrasta con las claves obligatorias de `config/validateEnv.js` del repositorio del backend y con `docs/integracion/para-backend.md`. La PR dice qué claves (solo nombres) hay que añadir o cambiar en el `terraform.tfvars` real de cada cuenta.
7. **Variable `VITE_*` de Amplify**: contrasta con el `.env.example` del frontend y sigue la skill `contract-change-review`.
8. **Documentación**: actualiza las tablas "Variables" y "Outputs" de `docs/referencia-modulos.md`, con el "Por defecto" correcto. Es el único sitio donde viven.
9. **Verificación**: ejecuta las entradas de `verificacion` de `.claude/flujo.json`; `docs-check` compara nombres y valores por defecto con la referencia.
