@echo off
title Iniciar o Plugin junto com o Windows
cd /d "%~dp0"

echo.
echo  ==========================================================
echo   Abrir o Plugin sozinho quando este PC ligar
echo  ==========================================================
echo.

set "PASTA=%~dp0"
set "INICIALIZAR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%INICIALIZAR%\Plugin IA Solus.bat"

if not exist "%INICIALIZAR%" (
  echo  [!] Nao achei a pasta de inicializacao do Windows:
  echo      %INICIALIZAR%
  echo.
  echo  Faca na mao: aperte Windows + R, digite  shell:startup
  echo  e arraste o INICIAR-PLUGIN.bat para dentro da pasta que abrir.
  echo.
  pause
  exit /b 1
)

rem Um .bat na pasta de inicializacao, em vez de um atalho .lnk.
rem O atalho precisava do PowerShell criando objeto COM - e e exatamente isso
rem que antivirus costuma bloquear (criar item de inicializacao e coisa que
rem virus faz). Um arquivo de texto simples nao levanta suspeita e nao precisa
rem de permissao de administrador.
> "%ATALHO%" echo @echo off
if errorlevel 1 goto :semPermissao

>>"%ATALHO%" echo rem Abre o Plugin IA Solus quando o Windows liga.
>>"%ATALHO%" echo rem Para desligar isso, e so apagar este arquivo.
>>"%ATALHO%" echo cd /d "%PASTA%"
>>"%ATALHO%" echo start "Plugin IA Solus" /min "%PASTA%INICIAR-PLUGIN.bat"

if not exist "%ATALHO%" goto :semPermissao

echo  Pronto! Na proxima vez que este PC ligar, o Plugin abre sozinho
echo  (a janela preta abre minimizada, na barra de tarefas).
echo.
echo  Para DESLIGAR isso depois:
echo    aperte Windows + R, digite  shell:startup
echo    e apague o arquivo "Plugin IA Solus.bat".
echo.
pause
exit /b 0

:semPermissao
echo  [!] O Windows nao deixou criar o arquivo de inicializacao.
echo.
echo  Quase sempre e o antivirus bloqueando - abrir programa junto com o
echo  Windows e coisa que virus faz, entao ele desconfia. Voce pode:
echo.
echo   1) Fazer na mao (funciona igual, sem depender de permissao):
echo      - aperte Windows + R
echo      - digite  shell:startup  e de Enter
echo      - arraste o arquivo INICIAR-PLUGIN.bat para dentro dessa pasta
echo        (segurando ALT, para criar atalho em vez de mover)
echo.
echo   2) Ou clicar com o botao direito neste arquivo e escolher
echo      "Executar como administrador".
echo.
pause
exit /b 1
