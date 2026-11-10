# Administradores de Cognito: alta y recuperación

Procedimiento de **operación** para crear y mantener a los administradores del pool de Cognito de cada entorno (módulo `cognito`, [referencia](referencia-modulos.md#módulo-cognito)). Lo ejecuta una persona con acceso a la cuenta de AWS del entorno (`dev` = `sigmetum-preprod`); ningún rol del ciclo lo hace. El contrato con el backend y el orden de despliegue están en [para-backend.md](integracion/para-backend.md#login-con-cognito-contrato-del-backend); el del frontend, en [para-frontend.md](integracion/para-frontend.md#login-con-cognito-formulario-propio).

- **Por qué hace falta:** el pool no tiene registro público (`allow_admin_create_user_only = true`) y el MFA TOTP es obligatorio (`mfa_configuration = "ON"`): nadie entra hasta que una persona crea su usuario y registra su TOTP.
- **Cuándo:** tras el `apply` que crea el pool y antes de probar el login; en `prod`, en su corte (`S18-prod`). Si se rehace el pool, hay que repetirlo para todos.
- **Alcance de la cuenta:** todo usuario del pool es administrador completo (`C16`, aceptado por el usuario): solo se da de alta a quien deba serlo.

Solo nombres y marcadores: **nunca** una contraseña, un código TOTP ni un valor en un documento, en el historial del terminal ni en un chat. Son acciones que cambian recursos de AWS: las ejecuta el humano, con confirmación expresa y en la cuenta del entorno. El pool no tiene registro público: los usuarios los crea un administrador.

El alta se hace **por la consola web de AWS** (sin comandos). Los nombres de los botones pueden variar un poco según la versión de la consola **(por confirmar)**.

**A. Crear el usuario** (lo hace quien tiene acceso a la cuenta del entorno; `dev` = `sigmetum-preprod`):

1. Entrar en la consola de AWS con esa cuenta y, arriba a la derecha, elegir la región del pool (`eu-west-3`, París).
2. Buscar el servicio **Cognito** → **User pools** → abrir el pool del entorno (el que tiene el id de `cognito_user_pool_id`, salida de Terraform).
3. Menú izquierdo **Users** → botón **Create user**.
4. Rellenar el formulario así:
   - **Invitation message:** *Send an email invitation*.
   - **User name / Email address:** el correo de la persona. Ese correo es su nombre de usuario y es **inmutable** (cambiarlo obliga a rehacer el pool).
   - **Mark email address as verified:** activado.
   - **Temporary password:** *Generate a password* (Cognito la crea y la envía por correo; no se escribe ninguna). Caduca a los tres días: si caduca, se borra el usuario y se vuelve a crear.
5. Pulsar **Create user**. El usuario aparece en la lista con estado *Force change password*.

**B. Primer acceso (lo hace cada administrador, con su propio correo y su móvil):**

1. Abrir la web del entorno (`amplify_url`) → pantalla de login (`/login`). Con el formulario propio del frontend (C18) se escribe ahí el correo y la contraseña; mientras no esté publicado, el botón de iniciar sesión lleva al Hosted UI de Cognito, que sigue activo como respaldo.
2. Poner el correo y la contraseña temporal del correo recibido.
3. Elegir una contraseña nueva (mínimo catorce caracteres, con mayúsculas, minúsculas, números y símbolos).
4. Se muestra un **código QR** (MFA obligatorio; lo pinta el Hosted UI o el formulario propio): escanearlo con una app de autenticación (Google Authenticator, Authy, 1Password...) y escribir el código de seis dígitos que genera.
5. Si todo va bien, vuelve a la web ya con la sesión iniciada. **Nunca** se escriben ni se pegan contraseñas, códigos TOTP ni el QR en documentos, chats o capturas.

**C. Comprobarlo** (consola → el pool → **Users** → clic en el usuario): *Confirmation status* = **Confirmed** y MFA con la app de autenticación registrada. Sin acceso a la consola, `aws cognito-idp admin-get-user` (solo lectura) lo muestra.

**D. Segundo administrador de emergencia** (decisión del usuario): repetir A, B y C con **otro correo y otra persona**. Con recuperación `admin_only` y un solo administrador, perder el TOTP bloquea el acceso y, en `prod`, `deletion_protection` complica rehacer el pool. Por `C16`, ese segundo usuario también es administrador completo.

**E. Si alguien pierde el TOTP:** otro administrador, o quien tenga la consola, abre el usuario en el pool y restablece su MFA (o lo borra y lo vuelve a crear con A). Es una acción que cambia recursos: la hace solo una persona y con confirmación expresa. Sin segundo administrador, la salida es rehacer el pool, que en `prod` exige un cambio revisado por `deletion_protection`.

## Si cambias algo

| Si cambias... | Revisa aquí |
|---|---|
| `modules/cognito` (política de contraseñas, MFA, `username_attributes`, invitaciones, recuperación de cuenta) | Los pasos A a E y los nombres de los campos de la consola |
| El pool o su región | El paso A (selección de región y de pool) |
