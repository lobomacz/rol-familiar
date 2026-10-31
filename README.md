# Rol Familiar

Vue SPA with Vuetify, Vuelidate and a Node SQLite API. Requires Docker Compose, or Node 24.6+ for local development.

## Docker development

```sh
docker compose up --build -d
docker compose logs -f
```

Open http://localhost:5174. Vite uses port 5174 with strict port selection. The API listens internally on port 3001 and is accessed through Vite's `/api` proxy. Source is bind-mounted for hot reload.

SQLite lives at `/app/data/rol-familiar.sqlite` in the `sqlite_data` named volume. It survives container recreation and `docker compose down`. `docker compose down -v` deletes the database and dependency volume. After changing dependencies, rebuild the image and run `docker compose run --rm app npm ci` to refresh the named dependency volume before restarting the app.

## Local development

```sh
npm ci
npm run dev
```

Local SQLite files live in ignored `data/`. Set `SQLITE_PATH` to choose another location. `npm run build` builds the SPA into `dist/`. `npm run preview` previews the static build only; it does not run or proxy the API. This container is a development environment, not a production deployment.

Run `npm test` to verify API validation and SQLite persistence across API restarts using an isolated temporary database.

## API

- `GET /api/health`: checks database availability.
- `GET /api/members`: lists saved members.
- `POST /api/members`: saves `{ "name": "Family member" }`; names must contain 1–100 characters.

Dependencies use exact stable versions, with the complete dependency tree locked in `package-lock.json`. Git origin is https://github.com/lobomacz/rol-familiar.git (the trailing punctuation in the supplied link is omitted).

## Inicio de sesión

La aplicación abre `/login` y redirige a `/roles` después de autenticar al usuario. La vista principal adapta el archivo de referencia y muestra las asignaciones semanales almacenadas en SQLite.

Cree un usuario en la misma base de datos del contenedor:

```sh
docker compose exec app npm run user:create -- nombre_usuario --generate
```

El comando muestra una contraseña aleatoria una sola vez. Para establecer una contraseña propia (12–1024 caracteres), proporciónela por entrada estándar al comando `docker compose exec -T app npm run user:create -- nombre_usuario`. En ejecución local, use `npm run user:create -- nombre_usuario --generate`.

Las contraseñas se almacenan con scrypt (N=32768, r=8, p=3), sal aleatoria y comparación de tiempo constante. Las sesiones duran ocho horas; SQLite almacena únicamente el hash del token. La cookie es HttpOnly y SameSite=Strict. Para un despliegue HTTPS, establezca `COOKIE_SECURE=true` en el servicio de API. No se incluye registro público.

`GET /api/auth/me` consulta la sesión; `POST /api/auth/login` recibe `{ "username": "...", "password": "..." }`; `POST /api/auth/logout` invalida la sesión. Los endpoints de miembros requieren autenticación. Los errores de credenciales muestran «Sus datos de acceso no son correctos!». Se limitan los intentos fallidos por dirección de conexión durante 15 minutos; el contador está en memoria y se reinicia con el API.

## Usuarios y roles semanales

La migración conserva IDs, credenciales y sesiones existentes. Los usuarios antiguos reciben su usuario como `nombre` y `Sin especificar` como `apellido`; la cuenta inicial `admin` recibe `nombre = Superadmin` y `rol_usuario = superadmin`, y las demás `usuario`. Se conservan `username` y `password_hash` junto a los campos solicitados. SQLite representa fechas como `YYYY-MM-DD`, booleanos como `0`/`1`/`NULL` y el enum mediante una restricción CHECK. Los IDs nuevos usan AUTOINCREMENT.

Al abrir la página principal se solicita la semana actual de lunes a domingo, calculada en `America/Managua`. Si no hay ninguna entrada de esa semana, se generan siete asignaciones en una transacción: participan los usuarios con `activo = 1`, primero los que nunca han tenido rol y después los de fecha más antigua, con rotación por ID en empates. Se actualiza `ultimo_rol` al asignar. Con menos de siete usuarios se repiten turnos; sin usuarios activos no se genera ninguna entrada. Una semana con al menos una entrada se conserva sin completar ni duplicar. La pestaña anterior consulta únicamente datos existentes. Los interruptores muestran `rol_switched` como indicador de solo lectura.

Desde **Perfil → Nuevo usuario**, los roles `admin` y `superadmin` pueden registrar nombre, apellido, usuario, último rol opcional, estado activo y rol de usuario. También pueden acceder desde **Explorar → Usuarios → +**. Los nuevos usuarios solo pueden recibir los roles `usuario` o `admin`. El rol `superadmin` está reservado para la cuenta `admin` inicial, que recibe automáticamente el nombre `Superadmin` y el rol `superadmin` al crearse mediante `user:create -- admin` cuando aún no existen usuarios. Los permisos se verifican en el API y en la interfaz. Los usuarios con rol `usuario` o `admin` requieren `activo = 1` para iniciar sesión y mantener una sesión válida; `0` o NULL bloquean el acceso. El rol `superadmin` está exento del control de estado activo para autenticarse, pero siempre requiere credenciales válidas y nunca participa en las asignaciones.

La herramienta local también admite `--nombre`, `--apellido` y `--rol`, por ejemplo:

```sh
docker compose exec app npm run user:create -- nuevo --generate --nombre Ana --apellido López --rol usuario
```

`POST /api/roles/ensure-current` genera o devuelve la semana actual. Si no existen entradas, requiere al menos dos usuarios activos cuyo rol no sea `superadmin`; de lo contrario, devuelve `generationBlocked: "INSUFFICIENT_ACTIVE_USERS"`. Genera los siete días en una transacción, asignando cada día un usuario al azar distinto del día anterior, incluso entre domingo y lunes. Conserva las semanas existentes y actualiza `ultimo_rol` de los participantes. `GET /api/roles?week=current` y `?week=previous` consultan semanas existentes. `POST /api/users` requiere privilegios administrativos y genera una contraseña temporal con el nombre seguido del apellido, en minúsculas, sin separador y recortando espacios al inicio y final de cada campo (los espacios internos se conservan). La misma función genera la contraseña de `POST /api/users/:id/reset-password`, disponible para administradores desde Explorar → Usuarios. Solo se almacena el hash. La cuenta `admin` está excluida de los restablecimientos.

La migración añade `password_reset_at` (fecha y hora UTC o NULL) a los usuarios existentes sin modificar sus contraseñas. La creación y el restablecimiento establecen esa fecha; el restablecimiento invalida todas las sesiones del usuario. Al iniciar sesión con una contraseña temporal, solo se permite consultar la sesión, cerrar sesión o cambiar la contraseña. `POST /api/auth/password` verifica la contraseña actual y exige una nueva diferente de exactamente 16 caracteres con minúsculas, mayúsculas, símbolos y números. Al guardarla, se limpia `password_reset_at` y se habilita el acceso normal.


### Sustituciones y consulta de semanas

En Roles, cada usuario solo puede cambiar el interruptor de sus asignaciones de la semana actual. Al activarlo, el diálogo muestra usuarios activos con rol `usuario` o `admin`, excluyendo al usuario actual y a participantes de otros intercambios pendientes. Cancelar no modifica datos. Si el sustituto tiene varios días asignados, un segundo desplegable permite elegir cuál cubrir a cambio; si tiene uno solo, se selecciona automáticamente. Aceptar modifica únicamente el día de origen y el día elegido del sustituto. Ambos participantes dejan de estar disponibles para otros intercambios de esa semana mientras el intercambio siga guardado. Los usuarios sin días asignados pueden cubrir el día de origen sin intercambio recíproco. Desactivar cualquiera de los días vinculados restaura ambas partes del intercambio, sin alterar otros intercambios ni semanas pasadas.

`GET /api/roles/:id/replacements` consulta las opciones del propietario; `PATCH /api/roles/:id/switch` recibe `{ "rol_switched": true, "replace_user": 123, "replace_role_id": 456 }` o `{ "rol_switched": false }`. Las opciones incluyen los días asignados (`days`: `id`, `date`) de cada usuario. `replace_role_id` es obligatorio cuando el sustituto tiene varios días y debe pertenecerle dentro de la semana actual. El servidor comprueba propietario, día elegido, semana actual y disponibilidad dentro de una transacción antes de guardar. Un cambio de disponibilidad produce un conflicto sin modificaciones parciales.

Explorar → Semanas abre la semana elegida en Roles. `GET /api/roles?start=YYYY-MM-DD` consulta una semana que comience en lunes sin generar entradas. Una semana histórica usa temporalmente la pestaña «Semana del X al Y» y sus interruptores son de solo lectura. Cambiar de pestaña o salir de Roles restaura «Semana anterior». Elegir la semana actual abre «Semana actual» con sus controles normales.

### Notas

La pestaña **Notas** permite a cualquier usuario autenticado crear notas para fechas con un rol existente, agregar texto sin reemplazar entradas anteriores y crear notas derivadas únicamente de una nota completa. Cada nota guarda su autor, fecha, prioridad (`normal`, `atencion`, `critical`) y responsable del día al crearla (el sustituto si corresponde). Los cambios posteriores al calendario no cambian ese responsable guardado para el historial; los permisos de completar siguen la asignación actual del día.

Durante la fecha asignada o antes, el usuario asignado al día o su sustituto activo pueden completar la nota. En Roles, el botón de notas a la izquierda del interruptor de cada día de la semana actual abre un diálogo con las notas y sus acciones de completar. A partir de la medianoche de **America/Managua** del día siguiente, solo `admin` o `superadmin` pueden completarla. La campana muestra el número total de notas vencidas pendientes de la familia. Sin pendientes no realiza ninguna acción. Con pendientes, los usuarios admin y superadmin pueden abrir una ventana con la lista, consultar cada nota y limpiar todos los avisos; los usuarios regulares no pueden abrir esta ventana. Limpiar todos completa de forma definitiva solo las notas vencidas pendientes, conservando las de hoy y futuras. **Completar y limpiar aviso** completa la nota y elimina su aviso para todos. El contador se actualiza al guardar y cada minuto. Completar es definitivo: no se puede editar, agregar texto ni reabrir una nota completa. Sí se puede crear una nueva nota pendiente vinculada a ella sin modificar la original.

Al iniciar la API, la migración idempotente `notes-and-append-only-entries-v1` crea `notes`, `note_entries`, índices y disparadores que preservan las entradas y bloquean las notas completas. No requiere comandos manuales de migración.

API autenticada: `GET /api/notes`, `POST /api/notes` (`date`, `text`, `priority`, `parent_id` opcional), `POST /api/notes/:id/entries` (`text`) y `POST /api/notes/:id/complete` y `POST /api/notes/clear-pending` (solo admin y superadmin). Las autorizaciones se verifican en el servidor.
