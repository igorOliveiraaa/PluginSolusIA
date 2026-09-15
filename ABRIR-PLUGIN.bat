@echo off
title Abrir o Plugin IA Solus
cd /d "%~dp0"

rem Abre o Plugin no navegador. Se ele nao estiver rodando, liga antes - em
rem segundo plano, sem janela preta na tela.

if exist "dados\plugin.pid" goto :abrir

start "" wscript.exe "%~dp0INICIAR-ESCONDIDO.vbs"

rem o servidor leva uns segundos para subir (banco + certificado)
ping -n 7 127.0.0.1 >nul

:abrir
start "" "http://localhost:3535"
exit /b 0
