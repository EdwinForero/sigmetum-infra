## Qué cambia y por qué

<!-- Qué módulo, entorno o variable cambia y qué problema resuelve. Si corrige un hallazgo, enlaza su id de docs/estado-y-deuda-tecnica.md. -->

## Cómo se ha probado

<!-- terraform plan revisado (sin pegar su salida) y, si aplica, comprobación manual tras un apply en preprod. -->

## Definición de terminado

La CI ejecuta estos comandos; márcalos si los has pasado en local.

- [ ] `terraform fmt -check -recursive`
- [ ] `terraform validate` (`environments/dev` y `environments/prod`)
- [ ] `node scripts/quality-check.mjs`
- [ ] `node scripts/docs-check.mjs`
- [ ] He revisado el `plan` sin pegar valores sensibles y sé en qué cuenta y entorno se aplicará
- [ ] Primero preprod, y solo tras comprobarlo, prod (si el cambio toca ambos entornos)

## Documentación

- [ ] He actualizado los documentos que indica `docs/guias/mantenimiento.md` (sección 2), en este mismo PR
- [ ] Hallazgos resueltos o nuevos en `docs/estado-y-deuda-tecnica.md`: <!-- ids, o "ninguno" -->

## Guías que aplican

- [ ] Buenas prácticas de Terraform (`docs/guias/buenas-practicas-terraform.md`)
- [ ] Seguridad, si toca IAM, S3, secretos, red, TLS o Amplify (`docs/guias/seguridad.md`)

## Frontend y backend

- [ ] Afecta al contrato con el frontend o con el backend: **sí / no**
  <!-- Si es sí: has actualizado docs/integracion/para-frontend.md o para-backend.md y aquí dices qué debe hacer cada equipo y en qué orden desplegar. -->

## Impacto en costes

<!-- Si añades o cambias un recurso facturable (tipo de instancia, balanceador, autoescalado...), estima el coste mensual. "Ninguno" si no aplica. -->
