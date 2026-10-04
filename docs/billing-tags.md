# Billing Tags — Cost Tracking

Todos los recursos tienen tags aplicados automáticamente por Terraform. Para que aparezcan en AWS Cost Explorer hay que activarlos manualmente una vez por cuenta.

## Tags aplicados a todos los recursos

| Tag | Valores | Propósito |
|---|---|---|
| `Project` | `sigmetum` | Filtra todos los costos del proyecto |
| `Environment` | `dev` / `prod` | Compara costos entre preprod y prod |
| `ManagedBy` | `terraform` | Identifica recursos gestionados por IaC |
| `Component` | `backend` / `frontend` / `storage` / `backend-ci` | Desglosa costos por servicio |

Con estos tags puedes responder preguntas como:
- ¿Cuánto cuesta el backend en preprod este mes?
- ¿Qué porcentaje del costo total es el frontend?
- ¿Cuánto ha subido prod vs el mes pasado?

---

## Activar los tags en AWS Cost Explorer

Hacer esto en **cada cuenta** (preprod y prod):

> **Región:** Cost Explorer es global — no importa qué región tengas seleccionada.

1. Abre **AWS Billing and Cost Management** → **Cost allocation tags**
2. Verás una lista con los tags que AWS ha detectado en los recursos
3. Selecciona los cuatro tags: `Project`, `Environment`, `ManagedBy`, `Component`
4. Clic en **Activate**

> Los tags tardan hasta 24 horas en aparecer en Cost Explorer después de activarlos.
> Solo aparecen tags de recursos que ya existen — actívalos después del primer `terraform apply`.

---

## Ver costos en Cost Explorer

1. **AWS Billing** → **Cost Explorer** → **Launch Cost Explorer**
2. En el panel, agrupa por el tag que quieras:
   - **Group by:** Tag → `Component` → ver desglose por backend/frontend/storage
   - **Filter:** Tag `Project` = `sigmetum` → ver solo costos del proyecto
3. Guarda el filtro como un reporte para revisarlo cada mes

---

## Tags de cuenta (Organizations)

Además de los tags en recursos, las cuentas en AWS Organizations tienen sus propios tags. Se añaden al crear cada cuenta (ver [aws-organizations-setup.md](aws-organizations-setup.md)):

| Cuenta | `Project` | `Environment` |
|---|---|---|
| sigmetum-preprod | `sigmetum` | `preprod` |
| sigmetum-prod | `sigmetum` | `prod` |

Esto te permite en Cost Explorer agrupar por cuenta con un nombre legible en vez de solo el Account ID.

## Notas

- Route53 no soporta tags en sus records — los costos de DNS aparecen sin tag de componente.
- Los recursos de Beanstalk (instancias EC2, Auto Scaling) heredan los tags del environment.
- El bucket de tfstate (`sigmetum-tfstate-dev` / `sigmetum-tfstate-prod`) no tiene tag `Component` — es infraestructura de Terraform, no de la app. Su costo es despreciable (pocos KB).
