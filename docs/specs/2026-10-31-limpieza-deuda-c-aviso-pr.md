# Aviso para PR: limpieza de deuda C (M1, M4, M2, M7, S1)

Fecha: 31/10/2026 · Cambio **crítico** (`app_env_vars`, contrato con el backend) · Spec: [design](2026-10-31-limpieza-deuda-c-design.md) · Plan: [plan](2026-10-31-limpieza-deuda-c-plan.md)

## Qué cambia

- M1: se quita `ssl_certificate_arn` de `environments/dev/variables.tf`; se borra `modules/networking/variables.tf` y la línea `environment` de las llamadas al módulo en `dev` y `prod`. No cambia ningún recurso. `ssl_certificate_arn` de `prod` y de `modules/beanstalk` se quedan.
- M7: `description` en todas las variables y outputs de módulos y entornos (sin cambiar `type`, `default`, `sensitive` ni nombres; no se poda ningún output). Nueva `validation` en `app_env_vars` de `modules/beanstalk`: exige por nombre las nueve claves de `required` de `validateEnv.js` del backend, acepta claves extra y no incluye valores.
- M4 y S1: se vacían `fmt` y `accountIds` en `KNOWN_DEBT` de `scripts/quality-check.mjs`; `noDescription.names` queda vacío. Las guías `aws-cli-setup.md` y `aws-organizations-setup.md` usan `<ID_CUENTA_GESTION>`, `<ID_CUENTA_DEV>` y `<ID_CUENTA_PROD>`.
- M2: sin cambio de código; cerrado como «no afecta» en `dev`; `prod` **(por confirmar)**.

## Qué mira el humano en `terraform plan` (dev y prod; no pegar la salida)

1. Esperado: «No changes» en los dos entornos. Si aparece cualquier recurso a crear, cambiar o destruir, parar y revisar.
2. La `validation` puede fallar con «Invalid value for variable... app_env_vars» (módulo `beanstalk`) si su `terraform.tfvars` no define alguna de las nueve claves. El mensaje solo lista nombres. Se corrige en el `tfvars` (fuera de git), no en el código.
3. Si el `terraform.tfvars` de `dev` aún define `ssl_certificate_arn`, Terraform avisa «Value for undeclared variable»: es un aviso, no un error; se puede quitar esa línea.
4. La comprobación real de la `validation` con valores reales solo ocurre aquí **(por confirmar)**. La prueba desechable (Terraform 1.15.5, nombres de las plantillas `.example`) dio «Success» con las claves de `dev` y de `prod`, y «Invalid value for variable» con una clave que falta y con el mapa vacío; con Terraform 1.5 no se probó (**por confirmar**).

## Frontend y backend

- **Frontend: nada que hacer por este cambio.** `modules/amplify` no cambia; `NODE_ENV`, `VITE_*` y el `build_spec` siguen igual. Nota fuera de alcance de infra (C15 en el estado): el log del build de `dev` mostró vulnerabilidades tras `npm ci` y un paquete JS grande; conviene revisar `npm audit` y dividir el paquete.
- **Backend: nada que hacer.** La `validation` exige solo lo que `validateEnv.js` ya exige al arrancar; no cambian claves ni valores de `app_env_vars`.
- Orden de despliegue: ninguno. El `apply`, si se hace, lo ejecuta el humano y no cambia recursos.

## Documentos de integración

`docs/integracion/para-frontend.md` (fila de `NODE_ENV`: M2 cerrado, `prod` por confirmar) y `docs/integracion/para-backend.md` (sección 2: la validación en `plan`) actualizados. Ninguno cambia el contrato.

## Por confirmar

- `terraform plan` sin cambios y `validation` con los `terraform.tfvars` reales en `dev` y `prod`.
- `validation` con Terraform 1.5 (versión mínima declarada).
- M2 en `prod` (no se ha compilado desde aquí).
