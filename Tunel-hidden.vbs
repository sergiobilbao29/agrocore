' AgroCore - lanzador totalmente oculto del tunel cloudflared.
' Invocado por la tarea programada de Windows (ver
' INSTALAR-TUNEL-AUTOMATICO.bat). Corre el helper _Tunel-hidden.cmd
' con ventana = 0 (invisible) y sin esperar.

Option Explicit
Dim shell, here, target
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
target = here & "\_Tunel-hidden.cmd"
shell.Run """" & target & """", 0, False
