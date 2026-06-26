# AgroCore Multi-Cliente

Cómo correr varias instancias de AgroCore en una misma PC (la tuya), cada una con su subdominio y sus datos aislados, listo para migrar a la PC del cliente cuando compre.

## Arquitectura

Cada cliente = **instancia totalmente aislada**:

| Cliente | Carpeta | Puerto | Base PostgreSQL | Subdominio | Tunnel Cloudflare |
|---|---|---|---|---|---|
| Demo (público) | `C:\AgroCore` | 3100 | `agrocore` | `demo.agrocore.ar` | `agrocore-demo` |
| Borghi (trial) | `C:\AgroCore-Borghi` | 3101 | `agrocore_borghi` | `borghi.agrocore.ar` | `agrocore-borghi` |
| Cliente N | `C:\AgroCore-<N>` | 310X | `agrocore_<n>` | `<n>.agrocore.ar` | `agrocore-<n>` |

**Cómo viaja una request:**

```
Cliente abre https://borghi.agrocore.ar/app
  ↓
DNS Cloudflare (A → tunnel)
  ↓
Cloudflare Tunnel (corriendo en tu PC)
  ↓ (busca hostname en config.yml)
  → ingress: borghi.agrocore.ar → http://localhost:3101
  ↓
Node.js (instancia C:\AgroCore-Borghi) en puerto 3101
  ↓
PostgreSQL local → base agrocore_borghi (SOLO sus datos)
```

## Alta de un cliente nuevo (proceso completo)

### 1. Correr el script (te hace casi todo)

```powershell
cd C:\AgroCore
.\Crear-Cliente.ps1 -Cliente "Borghi" -Puerto 3101
```

Esto:
- Clona `C:\AgroCore` → `C:\AgroCore-Borghi`
- Crea base `agrocore_borghi` en Postgres
- Genera `.env` con puerto 3101 y JWT_SECRET único
- Instala `npm` y aplica migraciones Prisma
- Crea lanzadores `INICIAR-AGROCORE.vbs` y `CERRAR-AGROCORE.bat`
- Arranca la instancia

### 2. Crear el túnel en Cloudflare (una sola vez)

```powershell
cloudflared tunnel create agrocore-borghi
# Anotá el Tunnel ID que imprime

cloudflared tunnel route dns agrocore-borghi borghi.agrocore.ar
```

### 3. Agregar la regla al `config.yml` de Cloudflare

Editar `C:\Users\sergi\.cloudflared\config.yml`. Buscar la sección `ingress:` y agregar **antes** de la regla catch-all (la que termina en 404 o `service: http_status:404`):

```yaml
ingress:
  - hostname: demo.agrocore.ar
    service: http://localhost:3100
  - hostname: borghi.agrocore.ar       # ← NUEVO
    service: http://localhost:3101     # ← NUEVO
  - service: http_status:404            # catch-all
```

### 4. Arrancar el túnel nuevo

En una terminal aparte (queda corriendo):
```powershell
cloudflared tunnel run agrocore-borghi
```

> **Mejor**: registralo como servicio Windows con NSSM o tarea programada para que arranque solo con la PC.

### 5. Probar

```
https://borghi.agrocore.ar/app
```

Debería abrir AgroCore con la base vacía.

## Crear usuario inicial en una instancia nueva

La instancia arranca con la base vacía (solo las tablas). Para crear el primer usuario admin:

**Opción A: desde la propia UI** si el endpoint de registro público está habilitado.

**Opción B: por psql** insertando directo:
```sql
-- Conectarse a la base del cliente
psql -U agrocore -d agrocore_borghi

-- Insertar admin (cambiar email/password)
-- El password va hasheado con bcrypt; lo más fácil es loguearse en Demo
-- como admin y crear la company + usuario desde la UI, después renombrarlo.
```

**Opción C (la práctica)**: temporariamente cambiar el `DATABASE_URL` de la instancia Demo para que apunte a `agrocore_borghi`, entrar como admin del Demo, crear company/user de Borghi, volver el `.env` original.

Ya casi: te conviene tener un script de seed que cree un usuario admin con email/password configurables.

## Comandos útiles

### Ver instancias corriendo
```powershell
netstat -ano | findstr "LISTENING" | findstr ":31"
```

### Frenar/iniciar una instancia
```powershell
# Frenar Borghi
cd C:\AgroCore-Borghi
.\CERRAR-AGROCORE.bat

# Iniciar Borghi
Start-Process .\INICIAR-AGROCORE.vbs
```

### Ver logs
```powershell
Get-Content C:\AgroCore-Borghi\logs\agrocore.log -Tail 50 -Wait
```

### Actualizar a una versión nueva del código

Cuando hagas un release nuevo (`git push` + nuevo tag), cada instancia se actualiza por separado:

```powershell
# Frenar
cd C:\AgroCore-Borghi
.\CERRAR-AGROCORE.bat

# Pull (clonando manualmente desde C:\AgroCore que sí tiene .git, o git pull si la creaste con git clone)
cd C:\AgroCore
git pull
# Después, sobrescribir los archivos clave en la instancia:
robocopy C:\AgroCore C:\AgroCore-Borghi backend\src\server.js
robocopy C:\AgroCore C:\AgroCore-Borghi AgroCore-web.html
robocopy C:\AgroCore\backend\prisma C:\AgroCore-Borghi\backend\prisma /E /XO

# Aplicar migraciones nuevas
cd C:\AgroCore-Borghi\backend
npx prisma generate
npx prisma migrate deploy

# Arrancar
cd C:\AgroCore-Borghi
Start-Process .\INICIAR-AGROCORE.vbs
```

> A mediano plazo: hacé que cada instancia tenga su propio `git clone` para hacer `git pull` directo. O escribí un `Actualizar-Todas-Las-Instancias.ps1`.

## Migración al servidor del cliente (cuando compre)

```powershell
cd C:\AgroCore
.\Migrar-Cliente-A-Servidor.ps1 -Cliente "Borghi"
```

Esto genera en tu Escritorio una carpeta `AgroCore-Borghi-Migracion-YYYYMMDD-HHMMSS` con:
- El dump completo de Postgres (`.sql`)
- El código + `.env`
- Un `LEEME-INSTALACION.txt` con los comandos exactos para restaurarlo en la PC del cliente o en AWS.

**Después** de migrar, recordá:
1. Apagar la instancia local de Borghi (`CERRAR-AGROCORE.bat`)
2. Sacar la regla del `config.yml` del túnel (o apuntar el subdominio a la nueva IP)
3. Borrar la base `agrocore_borghi` para no tener datos viejos dando vueltas

## Capacidad de tu PC

Cada instancia de AgroCore en idle consume aprox:
- **RAM**: 150-250 MB (Node) + ~100 MB (su pool de conexiones Postgres)
- **CPU**: <1% en idle
- **Disco**: la base crece según uso; típicamente 50-500 MB por cliente en el primer año.

Tu PC puede correr cómodamente **5-10 instancias** sin problema. Pasada esa cantidad, conviene migrar a un VPS chico o AWS.

## Seguridad y aislamiento

- Cada instancia tiene su propio **JWT_SECRET**, así que un token de Demo no sirve en Borghi y viceversa.
- Cada instancia tiene su propia **base de datos** PostgreSQL. Imposible que datos de un cliente se mezclen con otro.
- Cloudflare termina TLS, así que todo viaja encriptado de extremo a extremo.
- El único riesgo compartido es **tu PC**: si se rompe el disco, se caen todos. Backup diario de las bases recomendado (ver endpoint `/api/sistema/backup` ya implementado).
