@echo off
rem ============================================================
rem  KARAOKE DO BULLA - INICIALIZADOR v2 (kit portatil)
rem  1) Trabalha na pasta onde ESTE bat estiver (sem caminho fixo)
rem  2) Prefere o Node que vem DENTRO do kit (pasta node)
rem  3) Se nao achar, usa o Node instalado no sistema
rem  4) Sobe o servidor e abre a pagina do host
rem ============================================================
title Karaoke do Bulla - inicializador

rem --- 0) Pasta do kit: muda para onde este arquivo esta ---
cd /d "%~dp0"

rem --- 1) Conferencias do kit ---
if not exist server.js (
  echo.
  echo  [ERRO] server.js nao encontrado nesta pasta:
  echo         %cd%
  echo  O kit deve ter: server.js, repertorio.json e a pasta public.
  echo.
  pause
  exit /b 1
)

if not exist repertorio.json (
  echo.
  echo  [AVISO] repertorio.json nao encontrado nesta pasta.
  echo  O app vai subir com 0 musicas. Copie o repertorio.json do
  echo  repositorio para a pasta do kit e reinicie.
  echo.
  pause
)

rem --- 2) Node: primeiro o do kit (raiz ou pasta node), depois o do sistema ---
if exist "node.exe" (
  start "Karaoke do Bulla - servidor" cmd /k "node.exe server.js"
) else if exist "node\node.exe" (
  start "Karaoke do Bulla - servidor" cmd /k "node\node.exe server.js"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  [ERRO] Node nao encontrado: nem o node.exe do kit,
    echo  nem o Node instalado neste PC.
    echo  Como resolver:
    echo   1. Copie o node.exe do kit original para a raiz da pasta do kit.
    echo   2. Ou instale a versao LTS em https://nodejs.org - uma vez so.
    echo.
    pause
    exit /b 1
  )
  start "Karaoke do Bulla - servidor" cmd /k "node server.js"
)

rem --- 3) Abre a pagina do host ---
timeout /t 3 /nobreak >nul
start "" "http://localhost:8080/host.html"
echo.
echo  Servidor rodando na janela "Karaoke do Bulla - servidor".
echo  Para PARAR o app: feche aquela janela. A fila nao se perde.
echo  Pode fechar ESTA janela.
timeout /t 3 /nobreak >nul