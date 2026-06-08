; ============================================================
; AgroCore Installer — Inno Setup script
; Compila con Inno Setup 6 (https://jrsoftware.org/isdl.php).
; Doble clic al .iss en Inno Setup Compiler → Build → genera AgroCore-Setup.exe
;
; Lo que hace el instalador:
;   1. Verifica que esté Node 20 y PostgreSQL 17 (si no, los descarga e instala).
;   2. Copia el código de AgroCore a C:\AgroCore.
;   3. Crea la base de datos vacía y configura el .env con el password.
;   4. Corre npm install, prisma migrate deploy y prisma generate.
;   5. Crea los accesos directos en escritorio + menú Inicio + arranque automático.
;   6. Levanta el sistema y abre el navegador en http://localhost:3100.
; ============================================================

#define MyAppName        "AgroCore"
#define MyAppVersion     "0.7.0"
#define MyAppPublisher   "AgroCore SRL"
#define MyAppURL         "https://agrocore.ar"
#define MyAppExeName     "INICIAR-AGROCORE.vbs"
#define InstallDir       "{commonpf}\AgroCore"

[Setup]
AppId={{C0FE0AC0-1057-4E5F-9A1C-AGROCORE0001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\AgroCore
DefaultGroupName=AgroCore
DisableDirPage=no
DisableProgramGroupPage=yes
OutputBaseFilename=AgroCore-Setup-{#MyAppVersion}
SetupIconFile=agrocore-icon.ico
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
PrivilegesRequired=admin
DisableWelcomePage=no
LicenseFile=LICENSE.txt
WizardImageFile=wizard-banner.bmp
WizardSmallImageFile=wizard-small.bmp
UsePreviousAppDir=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon";       Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce
Name: "startmenuicon";     Description: "Crear acceso directo en el menú Inicio"; GroupDescription: "Accesos directos:"; Flags: checkedonce
Name: "autostart";         Description: "Iniciar AgroCore automáticamente con Windows"; GroupDescription: "Inicio automático:"; Flags: checkedonce
Name: "openbrowser";       Description: "Abrir AgroCore en el navegador al terminar"; GroupDescription: "Al terminar:"; Flags: checkedonce

[Files]
; Código del sistema (todo el directorio C:\AgroCore en el momento de compilar)
Source: "..\backend\*";   DestDir: "{app}\backend";    Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "node_modules\*,dist\*,*.log"
Source: "..\AgroCore-web.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\*.bat";       DestDir: "{app}";            Flags: ignoreversion
Source: "..\*.vbs";       DestDir: "{app}";            Flags: ignoreversion
Source: "..\Manual-Usuario.docx"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\Manual-Usuario.pdf";  DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; Instaladores de dependencias (Node.js + PostgreSQL portables, incluidos en el .exe)
Source: "deps\node-v20.18.0-x64.msi";          DestDir: "{tmp}"; Flags: dontcopy
Source: "deps\postgresql-17.2-1-windows-x64.exe"; DestDir: "{tmp}"; Flags: dontcopy
Source: "scripts\setup-database.ps1";          DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\post-install.ps1";            DestDir: "{app}\installer"; Flags: ignoreversion
Source: "Update-AgroCore.ps1";                 DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userdesktop}\AgroCore";                Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\backend\public\favicon.ico"; Tasks: desktopicon
Name: "{group}\AgroCore";                      Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\backend\public\favicon.ico"; Tasks: startmenuicon
Name: "{group}\Cerrar AgroCore";               Filename: "{app}\CERRAR-AGROCORE.bat"; Tasks: startmenuicon
Name: "{group}\Manual de usuario";             Filename: "{app}\Manual-Usuario.pdf"; Tasks: startmenuicon
Name: "{group}\Actualizar AgroCore";           Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Update-AgroCore.ps1"""; Tasks: startmenuicon
Name: "{commonstartup}\AgroCore (Auto-inicio)"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Run]
; 1. Verificar e instalar Node.js si no está
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -Command ""if (-not (Get-Command node -ErrorAction SilentlyContinue)) {{ Start-Process msiexec.exe -ArgumentList '/i','{tmp}\node-v20.18.0-x64.msi','/qn' -Wait }}"""; StatusMsg: "Verificando Node.js…"; Flags: runhidden waituntilterminated

; 2. Verificar e instalar PostgreSQL si no está (con password agrocore123 — se cambia después)
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -Command ""if (-not (Test-Path 'C:\Program Files\PostgreSQL\17')) {{ Start-Process '{tmp}\postgresql-17.2-1-windows-x64.exe' -ArgumentList '--mode unattended','--unattendedmodeui none','--superpassword agrocore123','--servicename postgresql-x64-17','--serverport 5432' -Wait }}"""; StatusMsg: "Verificando PostgreSQL…"; Flags: runhidden waituntilterminated

; 3. Crear base de datos AgroCore y configurar .env
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\installer\setup-database.ps1"" -InstallDir ""{app}"""; StatusMsg: "Creando base de datos…"; Flags: runhidden waituntilterminated

; 4. npm install + prisma generate + migrate deploy + seed
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\installer\post-install.ps1"" -InstallDir ""{app}"""; StatusMsg: "Instalando dependencias y aplicando migraciones (puede tardar 2-5 minutos)…"; Flags: runhidden waituntilterminated

; 5. Iniciar AgroCore (en background)
Filename: "{app}\{#MyAppExeName}"; StatusMsg: "Iniciando AgroCore…"; Flags: runhidden nowait

; 6. Abrir en el navegador
Filename: "http://localhost:3100"; Description: "Abrir AgroCore en el navegador"; Flags: shellexec postinstall nowait skipifsilent; Tasks: openbrowser

[UninstallRun]
; Detener Node antes de desinstalar
Filename: "taskkill.exe"; Parameters: "/F /IM node.exe"; Flags: runhidden; RunOnceId: "killNode"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\backend\node_modules"
Type: filesandordirs; Name: "{app}\backend\.prisma"
Type: files;          Name: "{commonstartup}\AgroCore (Auto-inicio).lnk"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  // Verificación inicial: Windows 10+ x64
  if not IsWin64 then begin
    MsgBox('AgroCore requiere Windows 64 bits.', mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  if GetWindowsVersion < $0A000000 then begin
    MsgBox('AgroCore requiere Windows 10 o superior.', mbCriticalError, MB_OK);
    Result := False;
  end;
end;
