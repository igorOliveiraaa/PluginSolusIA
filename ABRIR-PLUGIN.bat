@echo off
title Abrir o Plugin IA Solus
cd /d "%~dp0"

rem Abre o Plugin no navegador. Se ele nao estiver rodando, liga antes - em
rem segundo plano, sem janela preta na tela.
rem
rem "Esta rodando" = tem alguem atendendo na porta 3535. Nao basta existir o
rem dados\plugin.pid: depois de faltar luz ou desligar no botao ele fica para
rem tras, e antes isso fazia abrir uma pagina morta em vez de ligar o Plugin.

netstat -ano -p tcp | findstr ":3535" | findstr "LISTENING" >nul
if not errorlevel 1 goto :abrir

del "dados\plugin.pid" >nul 2>&1
start "" wscript.exe "%~dp0INICIAR-ESCONDIDO.vbs"

rem o servidor leva uns segundos para subir (banco + certificado)
ping -n 7 127.0.0.1 >nul

:abrir
start "" "http://localhost:3535"
exit /b 0
