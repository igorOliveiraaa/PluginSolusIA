@echo off
title Parar o Plugin IA Solus
cd /d "%~dp0"

rem Fecha o Plugin que esta rodando em segundo plano (sem janela na tela).
rem Acha o programa pelo numero que o proprio servidor deixa em dados\plugin.pid.

if not exist "dados\plugin.pid" goto :naoEstaRodando

set "PID="
set /p PID=<dados\plugin.pid
if "%PID%"=="" goto :naoEstaRodando

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

:naoEstaRodando
del "dados\plugin.pid" >nul 2>&1
echo.
echo  O Plugin nao esta rodando neste computador (nada para fechar).
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0
