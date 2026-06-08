# AgroCore — Instalador para Windows

Este directorio contiene los archivos para compilar el instalador `.exe` único que instala AgroCore en una PC nueva con un par de clics.

## Qué hace el instalador

Cuando el usuario hace doble clic al `.exe`:

1. **Verifica e instala Node.js 20** (si no está). Usa el `.msi` oficial incluido.
2. **Verifica e instala PostgreSQL 17** (si no está). Configura la contraseña inicial automáticamente.
3. **Copia el código de AgroCore** a `C:\AgroCore`.
4. **Crea la base de datos** `agrocore`, el usuario `agrocore` con password random, y arma el `.env` del backend.
5. **Corre `npm install`**, **`prisma migrate deploy`** y **`prisma generate`**.
6. **Crea los accesos directos**: escritorio + menú Inicio + auto-arranque con Windows.
7. **Levanta el sistema** y opcionalmente **abre el navegador** en `http://localhost:3100`.

El log completo de la instalación queda en `%TEMP%\agrocore-install.log`.

## Cómo compilar el `.exe`

Una sola vez:

1. Bajar e instalar **Inno Setup 6** (gratis): https://jrsoftware.org/isdl.php
2. Descargar los redistribuibles y guardarlos en `installer/deps/`:
   - `node-v20.18.0-x64.msi` → https://nodejs.org/dist/v20.18.0/
   - `postgresql-17.2-1-windows-x64.exe` → https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
3. Conseguir o crear los assets visuales en `installer/`:
   - `agrocore-icon.ico` — icono de la app (64×64 o más).
   - `wizard-banner.bmp` — banner del wizard (164×314 px).
   - `wizard-small.bmp` — banner chico (55×58 px).
   - `LICENSE.txt` — texto del EULA o licencia de uso del cliente.

Después, cada vez que querés generar una nueva versión del instalador:

1. Asegurate que `C:\AgroCore` tiene el código actualizado y testeado.
2. Editá `MyAppVersion` en `AgroCore-Installer.iss` con la versión nueva.
3. Doble clic en `AgroCore-Installer.iss` → se abre Inno Setup Compiler.
4. Menú **Build → Compile** (F9).
5. Sale `AgroCore-Setup-<version>.exe` en `installer/Output/`.

## Estructura del directorio

```
installer/
├── AgroCore-Installer.iss     ← script Inno Setup (este es el principal)
├── README.md                  ← este archivo
├── agrocore-icon.ico          ← icono (lo creás vos o lo bajás del repo de assets)
├── wizard-banner.bmp          ← banner grande del wizard
├── wizard-small.bmp           ← banner chico
├── LICENSE.txt                ← EULA del cliente
├── deps/
│   ├── node-v20.18.0-x64.msi             ← Node 20.x oficial
│   └── postgresql-17.2-1-windows-x64.exe ← PostgreSQL 17.x oficial
├── scripts/
│   ├── setup-database.ps1     ← crea DB + usuario + .env
│   └── post-install.ps1       ← npm install + prisma migrate + seed
└── Output/
    └── AgroCore-Setup-X.Y.Z.exe   ← generado por Inno Setup
```

## Tamaño esperado

- Node MSI: ~30 MB
- PostgreSQL exe: ~310 MB
- Código AgroCore: ~5 MB
- **Total instalador .exe: ~350 MB**

Si querés un instalador más liviano, podés sacar PostgreSQL y pedirle al usuario que lo instale aparte (en ese caso, comentá el `Source:` y el `[Run]` correspondiente).

## Actualizaciones

Una vez instalado, el cliente actualiza el sistema desde **menú Inicio → AgroCore → "Actualizar AgroCore"** (corre `Update-AgroCore.ps1`). El script:

- Hace un backup automático de la base ANTES de actualizar.
- Hace `git pull` (si el dir es repo git) o descarga el ZIP de la última release.
- Corre `npm install` + `prisma migrate deploy` + `prisma generate`.
- Reinicia el server y verifica que vuelva a responder.

## Solución de problemas

**El usuario reporta que el instalador "no abre AgroCore" al terminar.**
Revisar el log en `%TEMP%\agrocore-install.log`. Lo más común:
- PostgreSQL no se instaló por antivirus → desactivar el AV y reintentar.
- npm install falló por falta de internet → reintentar con conexión estable.

**El sistema no arranca después de instalar.**
Abrir `C:\AgroCore\backend\.env` y verificar que el `DATABASE_URL` tiene la password correcta. Si está mal, regenerarla con `installer\scripts\setup-database.ps1`.

**El cliente quiere reinstalar desde cero.**
1. Desinstalar AgroCore desde Panel de control.
2. Borrar manualmente `C:\AgroCore\backend\node_modules` si quedó.
3. Borrar la base con `dropdb -U postgres agrocore` (perderá los datos — ¡hacer backup antes!).
4. Volver a correr el instalador.
