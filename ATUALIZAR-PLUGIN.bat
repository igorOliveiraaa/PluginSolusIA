@echo off
title Atualizar Plugin IA Solus
cd /d "%~dp0"
echo.
echo ==================================================
echo   Atualizando o Plugin IA Solus
echo ==================================================
echo.
echo  Antes: FECHE a janela preta do Plugin, se estiver aberta.
echo  Suas configuracoes e o historico NAO sao apagados.
echo.
pause

where git >nul 2>nul
if errorlevel 1 (
  echo [!] O Git nao esta instalado neste PC, entao nao da para atualizar sozinho.
  echo     Baixe o projeto de novo pelo GitHub e copie a pasta "dados" da versao antiga.
  pause
  exit /b 1
)

echo Baixando a versao nova do GitHub...
git pull
if errorlevel 1 (
  echo.
  echo [!] Nao consegui baixar a atualizacao. Confira a internet e tente de novo.
  pause
  exit /b 1
)

echo.
echo Atualizando o que o Plugin precisa...
call npm install --omit=dev
if errorlevel 1 (
  echo [!] Deu erro ao instalar. Tente de novo.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo   Atualizado! Agora de dois cliques em INICIAR-PLUGIN.bat
echo ==================================================
pause
