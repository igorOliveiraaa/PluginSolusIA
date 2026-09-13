@echo off
title Instalar Plugin IA Solus
cd /d "%~dp0"
echo.
echo ==================================================
echo   Instalando o Plugin IA Solus
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] O Node.js nao esta instalado neste computador.
  echo.
  echo     Vou abrir o site agora. Baixe a versao LTS, instale
  echo     indo em Avancar ate o fim, e depois rode este arquivo de novo.
  start https://nodejs.org/pt
  echo.
  pause
  exit /b 1
)

node -e "process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo [!] O Node.js deste computador e muito antigo.
  echo     Instale a versao LTS mais nova pelo site que vou abrir.
  start https://nodejs.org/pt
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set VERSAO=%%v
echo Node.js encontrado: %VERSAO%
echo.
echo Baixando o que o Plugin precisa. Pode levar alguns minutos...
echo.
call npm install --omit=dev
if errorlevel 1 (
  echo.
  echo [!] Deu erro na instalacao. Confira se o PC esta com internet
  echo     e rode este arquivo de novo.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo   Instalado!
echo.
echo   Agora de dois cliques em INICIAR-PLUGIN.bat
echo ==================================================
echo.
pause
