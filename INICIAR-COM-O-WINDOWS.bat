@echo off
title Iniciar o Plugin junto com o Windows
cd /d "%~dp0"
echo.
echo Isto faz o Plugin abrir sozinho sempre que este PC ligar.
echo (a janela abre minimizada, na barra de tarefas)
echo.

powershell -NoProfile -Command "$atalho = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Plugin IA Solus.lnk'); $atalho.TargetPath = '%~dp0INICIAR-PLUGIN.bat'; $atalho.WorkingDirectory = '%~dp0'; $atalho.WindowStyle = 7; $atalho.Save()"

if errorlevel 1 (
  echo [!] Nao consegui criar o atalho de inicializacao.
) else (
  echo Pronto. Na proxima vez que o PC ligar, o Plugin abre sozinho.
  echo Para desligar isso: aperte Windows + R, digite shell:startup
  echo e apague o atalho "Plugin IA Solus".
)
echo.
pause
