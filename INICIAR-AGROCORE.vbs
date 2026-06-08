' ============================================================
'  INICIAR AGROCORE  (segundo plano, sin ventana)
'  Arranca el servidor de AgroCore SIN mostrar ninguna consola.
'  Queda corriendo "por debajo". Para cerrarlo: CERRAR-AGROCORE.bat
' ============================================================
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\AgroCore\backend"
' El 0 = ventana oculta ; False = no esperar a que termine
sh.Run "cmd /c npm start", 0, False
