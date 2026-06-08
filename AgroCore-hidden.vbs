' AgroCore - lanzador totalmente oculto del backend.
' Invocado por la tarea programada de Windows (ver
' INSTALAR-INICIO-AUTOMATICO.bat). Corre el helper _AgroCore-hidden.cmd
' con ventana = 0 (invisible) y sin esperar.

Option Explicit
Dim shell, here, target
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
target = here & "\_AgroCore-hidden.cmd"
shell.Run """" & target & """", 0, False