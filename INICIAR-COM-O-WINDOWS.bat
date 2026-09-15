@echo off
title Iniciar o Plugin junto com o Windows
cd /d "%~dp0"

echo.
echo  ==========================================================
echo   Abrir o Plugin sozinho quando este PC ligar
echo  ==========================================================
echo.
echo  Use isto SO no PC servidor da loja (o mesmo que tem o Solus).
echo  O Plugin vai subir em SEGUNDO PLANO: sem janela preta na tela.
echo.
pause

set "PASTA=%~dp0"
set "INICIALIZAR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ANTIGO=%INICIALIZAR%\Plugin IA Solus.bat"
set "ATALHO=%INICIALIZAR%\Plugin IA Solus.vbs"

if not exist "%INICIALIZAR%" goto :semPasta

rem versao antiga deixava um .bat aqui, que abria a janela preta minimizada
if exist "%ANTIGO%" del "%ANTIGO%" >nul 2>&1

rem Um .vbs na pasta de inicializacao, em vez de um atalho .lnk.
rem O atalho precisava do PowerShell criando objeto COM - e e exatamente isso
rem que antivirus costuma bloquear (criar item de inicializacao e coisa que
rem virus faz). Um arquivo de texto simples nao levanta suspeita e nao precisa
rem de permissao de administrador. E, sendo .vbs, nao pisca janela nenhuma.
> "%ATALHO%" echo ' Abre o Plugin IA Solus quando o Windows liga, em segundo plano.
if errorlevel 1 goto :semPermissao

>>"%ATALHO%" echo ' Para desligar isso, e so apagar este arquivo.
>>"%ATALHO%" echo CreateObject("WScript.Shell").Run "wscript.exe ""%PASTA%INICIAR-ESCONDIDO.vbs""", 0, False

if not exist "%ATALHO%" goto :semPermissao

echo.
echo  Pronto! Na proxima vez que este PC ligar, o Plugin sobe sozinho,
echo  sem aparecer janela nenhuma na tela.
echo.
echo  No dia a dia:
echo    ABRIR-PLUGIN.bat   abre o Plugin no navegador (e liga, se precisar)
echo    PARAR-PLUGIN.bat   fecha o Plugin
echo    dados\plugin-log.txt  mostra o que aconteceu, se der problema
echo.
echo  Para DESLIGAR a abertura automatica depois:
echo    aperte Windows + R, digite  shell:startup
echo    e apague o arquivo "Plugin IA Solus.vbs".
echo.
pause
exit /b 0

:semPasta
echo  [!] Nao achei a pasta de inicializacao do Windows:
echo      %INICIALIZAR%
echo.
echo  Faca na mao: aperte Windows + R, digite  shell:startup
echo  e arraste o INICIAR-ESCONDIDO.vbs para dentro da pasta que abrir.
echo.
pause
exit /b 1

:semPermissao
echo  [!] O Windows nao deixou criar o arquivo de inicializacao.
echo.
echo  Quase sempre e o antivirus bloqueando - abrir programa junto com o
echo  Windows e coisa que virus faz, entao ele desconfia. Voce pode:
echo.
echo   1) Fazer na mao (funciona igual, sem depender de permissao):
echo      - aperte Windows + R
echo      - digite  shell:startup  e de Enter
echo      - arraste o arquivo INICIAR-ESCONDIDO.vbs para dentro dessa pasta
echo        (segurando ALT, para criar atalho em vez de mover)
echo.
echo   2) Ou clicar com o botao direito neste arquivo e escolher
echo      "Executar como administrador".
echo.
pause
exit /b 1
