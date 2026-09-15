' Abre o Plugin IA Solus em SEGUNDO PLANO: sem janela preta nenhuma na tela.
'
' Por que um .vbs e nao um .bat: arquivo .bat SEMPRE abre a janela preta (no
' maximo minimizada, ocupando a barra de tarefas). O Windows so consegue rodar
' um programa de console totalmente escondido por aqui.
'
' O que aparece na tela: nada. Para saber se esta funcionando, abra o Plugin no
' navegador (ABRIR-PLUGIN.bat). Para fechar, use PARAR-PLUGIN.bat.
' Se der algum problema, a explicacao fica em  dados\plugin-log.txt

Option Explicit

Dim shell, fso, pasta, comando
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

pasta = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = pasta

If Not fso.FolderExists(pasta & "\node_modules") Then
  MsgBox "O Plugin ainda nao foi instalado neste computador." & vbCrLf & vbCrLf & _
         "De dois cliques em INSTALAR.bat primeiro.", vbExclamation, "Plugin IA Solus"
  WScript.Quit 1
End If

If Not fso.FolderExists(pasta & "\dados") Then fso.CreateFolder(pasta & "\dados")

' PLUGIN_SEGUNDO_PLANO avisa o servidor que nao ha ninguem olhando a tela
' (assim ele nao abre o navegador sozinho quando o PC liga).
' Tudo que ele escreveria na janela preta vai para o arquivo de log.
comando = "cmd /c set PLUGIN_SEGUNDO_PLANO=1&& node src\servidor.js > dados\plugin-log.txt 2>&1"

' 0 = sem janela nenhuma   False = nao fica esperando o servidor terminar
shell.Run comando, 0, False
