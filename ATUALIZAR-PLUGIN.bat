@echo off
setlocal enabledelayedexpansion
title Atualizar o Plugin IA Solus
cd /d "%~dp0"

rem Atualiza o Plugin com DOIS CLIQUES, sem Git e sem baixar ZIP na mao.
rem
rem   - se o projeto veio do Git, usa "git pull" (mais rapido);
rem   - senao, baixa o ZIP do GitHub e copia por cima, PULANDO a pasta dados.
rem
rem A pasta "dados" (chave da IA, lojas, historico, logo e configuracao) NUNCA e
rem tocada - e por isso que atualizar nao pede nada de novo depois.
rem
rem Para testar em outra pasta:  ATUALIZAR-PLUGIN.bat "C:\uma\pasta\de\teste"

set "PROJETO=https://github.com/igorOliveiraaa/PluginSolusIA"
set "DESTINO=%~dp0"
if not "%~1"=="" set "DESTINO=%~1\"

echo.
echo  ==========================================================
echo   Atualizando o Plugin IA Solus
echo  ==========================================================
echo.
echo   Pasta: %DESTINO%
echo.
echo   Suas configuracoes, historico e logo NAO sao apagados.
echo.
pause

rem ---- 1. fecha o Plugin, se estiver aberto ----------------------------------
if exist "%DESTINO%dados\plugin.pid" (
  echo  Fechando o Plugin que esta aberto...
  set /p PID=<"%DESTINO%dados\plugin.pid"
  taskkill /PID !PID! /T /F >nul 2>&1
  del "%DESTINO%dados\plugin.pid" >nul 2>&1
  echo  [ok] Plugin fechado.
  echo.
)

rem ---- 2. caminho rapido: projeto baixado com Git ----------------------------
if exist "%DESTINO%.git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo  Baixando a versao nova pelo Git...
    pushd "%DESTINO%"
    git pull
    set ERRO=!errorlevel!
    popd
    if !ERRO! equ 0 goto :instalar
    echo  [!] O Git nao conseguiu. Vou baixar o arquivo direto.
    echo.
  )
)

rem ---- 3. sem Git: baixa o ZIP do GitHub -------------------------------------
set "TEMPO=%RANDOM%"
set "ZIP=%TEMP%\plugin-solus-%TEMPO%.zip"
set "PASTATEMP=%TEMP%\plugin-solus-%TEMPO%"

echo  Baixando a versao nova do GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%PROJETO%/archive/refs/heads/main.zip' -OutFile '%ZIP%' -UseBasicParsing -TimeoutSec 180 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :semInternet
if not exist "%ZIP%" goto :semInternet

echo  Abrindo o arquivo baixado...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%PASTATEMP%' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :zipRuim

set "ORIGEM="
for /d %%P in ("%PASTATEMP%\*") do set "ORIGEM=%%P"
if not defined ORIGEM goto :zipRuim

echo  Copiando os arquivos novos...
rem /E copia tudo; /XD pula pastas que sao da loja ou geradas aqui;
rem /NFL /NDL /NJH /NJS deixam a tela limpa. Codigo 8 ou mais = erro de verdade.
robocopy "%ORIGEM%" "%DESTINO%." /E /XD dados node_modules .git /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :semPermissao

rd /s /q "%PASTATEMP%" >nul 2>&1
del "%ZIP%" >nul 2>&1

:instalar
echo.
echo  Conferindo o que o Plugin precisa para rodar...
pushd "%DESTINO%"
call npm install --omit=dev
set ERRO=%errorlevel%
popd
if not "%ERRO%"=="0" goto :erroNpm

echo.
echo  ==========================================================
echo   Pronto! O Plugin esta atualizado.
echo  ==========================================================
echo.
echo   Para abrir: de dois cliques em ABRIR-PLUGIN.bat
echo   (ou INICIAR-PLUGIN.bat, se quiser ver a janela preta).
echo.
pause
exit /b 0

:semInternet
echo.
echo  [!] Nao consegui baixar a atualizacao.
echo      Confira se este PC esta com internet e tente de novo.
echo      Se a loja bloqueia o GitHub, baixe o ZIP em outro PC e copie
echo      o conteudo por cima desta pasta (sem apagar a pasta "dados").
echo.
pause
exit /b 1

:zipRuim
echo.
echo  [!] O arquivo baixado veio quebrado. Tente de novo daqui a pouco.
echo.
del "%ZIP%" >nul 2>&1
pause
exit /b 1

:semPermissao
echo.
echo  [!] O Windows nao deixou gravar os arquivos novos nesta pasta.
echo      Quase sempre e o Plugin ainda aberto ou o antivirus.
echo      Feche o Plugin (PARAR-PLUGIN.bat) e tente de novo; se continuar,
echo      clique com o botao direito neste arquivo e escolha
echo      "Executar como administrador".
echo.
pause
exit /b 1

:erroNpm
echo.
echo  [!] Os arquivos novos chegaram, mas a instalacao das partes do
echo      Plugin falhou. Confira a internet e rode INSTALAR.bat.
echo.
pause
exit /b 1
