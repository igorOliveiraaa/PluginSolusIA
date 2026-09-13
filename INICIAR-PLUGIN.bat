@echo off
title Plugin IA Solus  -  NAO FECHE ESTA JANELA
cd /d "%~dp0"

if not exist node_modules (
  echo.
  echo [!] O Plugin ainda nao foi instalado.
  echo     De dois cliques em INSTALAR.bat primeiro.
  echo.
  pause
  exit /b 1
)

node src\servidor.js

echo.
echo O Plugin parou. Se nao foi voce que fechou, leia a mensagem acima.
pause
