@echo off
setlocal
chcp 65001 >nul
title Sanal Masa
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [HATA] Node.js bulunamadi.
  echo         https://nodejs.org adresinden "LTS" surumunu indirip kur,
  echo         sonra bu dosyaya tekrar cift tikla.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo  Ilk calistirma: gerekli paket kuruluyor...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo  [HATA] Paket kurulamadi. Internet baglantini kontrol et.
    pause
    exit /b 1
  )
)

node server\index.js %*

echo.
echo  Masa kapandi.
pause
endlocal
