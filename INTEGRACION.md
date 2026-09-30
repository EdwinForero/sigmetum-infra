# Integración con el frontend y el backend

SIGMETUM-A son tres repositorios (`sigmetum-frontend`, `sigmetum-backend`, `sigmetum-infra`) que se despliegan por separado. Convención completa en [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md#3-contrato-con-el-frontend-y-el-backend-convención-entre-repositorios).

## Documentos de este repositorio

- **[docs/integracion/para-frontend.md](docs/integracion/para-frontend.md):** lo que esta infraestructura ofrece y necesita del frontend (Amplify, `build_spec`, variables `VITE_*`, dominios, recursos estáticos).
- **[docs/integracion/para-backend.md](docs/integracion/para-backend.md):** lo que ofrece y necesita del backend (`app_env_vars`, health check, ALB, IAM de S3, correo saliente).

## Documentos de los repositorios hermanos

- **Frontend:** `../sigmetum-frontend/docs/integracion/para-infra.md` (local) — en GitHub: https://github.com/EdwinForero/sigmetum-frontend/blob/master/docs/integracion/para-infra.md (disponible cuando la rama `feature/sigmetum_front_v2` se fusione en `master`).
- **Backend:** no tiene `docs/integracion/` propio; su contrato es `../sigmetum-backend/config/validateEnv.js` y `index.js`, citados en `para-backend.md`.

Antes de tocar `modules/amplify`, `modules/storage`, `app_env_vars`, dominios, región o el bucket, revisa el documento `para-X.md` correspondiente y deja constancia en la PR (sección 3 de [docs/guias/mantenimiento.md](docs/guias/mantenimiento.md)).
