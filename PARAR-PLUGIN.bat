@echo off
title Parar o Plugin IA Solus
cd /d "%~dp0"

rem Fecha o Plugin que esta rodando em segundo plano (sem janela na tela).
rem
rem Quem e o Plugin: o programa node.exe que esta atendendo na porta 3535.
rem NAO usa so o numero guardado em dados\plugin.pid: se o PC desligou no botao
rem ou faltou luz, esse numero fica para tras - e o Windows pode dar o MESMO
rem numero a outro programa (ate ao Solus). Fechar "pelo numero" derrubaria ele.

set "PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /C:":3535 " ^| findstr "LISTENING"') do set "PID=%%P"
if not defined PID goto :naoEstaRodando

rem na porta 3535 tem que estar o node.exe (o Plugin), e nao outro programa
tasklist /FI "PID eq %PID%" /FI "IMAGENAME eq node.exe" /NH | findstr /I "node.exe" >nul
if errorlevel 1 goto :outroPrograma

taskkill /PID %PID% /T /F >nul 2>&1
if errorlevel 1 goto :naoEstaRodando

del "dados\plugin.pid" >nul 2>&1

echo.
echo  Pronto: o Plugin foi fechado.
echo.
echo  Para abrir de novo, de dois cliques em INICIAR-ESCONDIDO.vbs
echo  (em segundo plano) ou em INICIAR-PLUGIN.bat (com a janela preta).
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0

:outroPrograma
echo.
echo  [!] Outro programa (nao o Plugin) esta usando a porta 3535.
echo      Nada foi fechado.
echo.
ping -n 6 127.0.0.1 >nul
exit /b 1

:naoEstaRodando
rem arquivo que sobrou de um desligamento no botao: so apaga, nao fecha nada
del "dados\plugin.pid" >nul 2>&1
echo.
echo  O Plugin nao esta rodando neste computador (nada para fechar).
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0
