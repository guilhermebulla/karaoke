@echo off
rem ============================================================
rem  KARAOKE DO BULLA - INICIALIZADOR (duplo clique)
rem  1) Confere se o Node esta instalado
rem  2) Sobe o servidor em janela propria
rem  3) Abre a pagina do host no navegador
rem  Pasta do projeto (edite aqui se mudar de lugar):
rem ============================================================
cd /d C:\karaoke

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERRO] Node.js nao encontrado neste computador.
  echo  Instale a versao LTS em: https://nodejs.org
  echo  Depois clique de novo em iniciar-karaoke.bat
  echo.
  pause
  exit /b 1
)

if not exist server.js (
  echo.
  echo  [ERRO] server.js nao encontrado em C:\karaoke
  echo.
  pause
  exit /b 1
)

start "Karaoke do Bulla - servidor" cmd /k "node server.js"
timeout /t 3 /nobreak >nul
start "" "http://localhost:8080/host.html"
echo.
echo  Servidor rodando na janela "Karaoke do Bulla - servidor".
echo  Para PARAR o app: feche aquela janela. A fila nao se perde.
echo  Pode fechar ESTA janela.
timeout /t 3 /nobreak >nul