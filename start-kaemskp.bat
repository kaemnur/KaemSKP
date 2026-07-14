@echo off
setlocal EnableExtensions

set "PROJECT_DIR=C:\Users\kaemn\OneDrive\Desktop\PROJECTS\KaemSKP"
set "HOST=127.0.0.1"
set "PORT=3726"
set "BASE_URL=http://127.0.0.1:3726"
set "HEALTH_URL=%BASE_URL%/api/health"
set "APP_URL=%BASE_URL%/beranda"
set "LOG_FILE=%PROJECT_DIR%\kaemskp-dev.log"
set "ERR_LOG_FILE=%PROJECT_DIR%\kaemskp-dev.err.log"

cd /d "%PROJECT_DIR%" || (
  call :fail "Folder project KaemSKP tidak ditemukan: %PROJECT_DIR%"
  exit /b 1
)

call :check_kaemskp
if not errorlevel 1 goto open_browser

call :check_port_busy
if not errorlevel 1 (
  call :fail "Port 3726 sedang digunakan. Tutup proses lama KaemSKP."
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  call :fail "Node.js/npm belum terdeteksi. Pastikan Node.js sudah terinstall."
  exit /b 1
)

type nul > "%LOG_FILE%" 2>nul
type nul > "%ERR_LOG_FILE%" 2>nul

echo Menjalankan server KaemSKP di port %PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:KAEMSKP_NO_OPEN='1'; Start-Process -FilePath 'cmd.exe' -ArgumentList '/d /c npm run dev >> %LOG_FILE% 2>> %ERR_LOG_FILE%' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden" >nul 2>nul
if errorlevel 1 (
  call :fail "Server KaemSKP gagal dijalankan. Cek kaemskp-dev.err.log."
  exit /b 1
)

echo Menunggu server KaemSKP siap...
for /l %%I in (1,1,60) do (
  call :check_kaemskp
  if not errorlevel 1 goto open_browser
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1" >nul 2>nul
)

call :fail "Server KaemSKP tidak merespons dalam 60 detik. Cek kaemskp-dev.err.log."
exit /b 1

:open_browser
start "" "%APP_URL%"
exit /b 0

:check_kaemskp
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 2; if ($response.ok -eq $true -and $response.name -eq 'KaemSKP') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>nul
exit /b %errorlevel%

:check_port_busy
powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $async = $client.BeginConnect('%HOST%', %PORT%, $null, $null); if ($async.AsyncWaitHandle.WaitOne(500)) { $client.EndConnect($async); exit 0 }; exit 1 } catch { exit 1 } finally { $client.Close() }" >nul 2>nul
exit /b %errorlevel%

:fail
set "KAEMSKP_ERROR_MESSAGE=%~1"
if "%KAEMSKP_FROM_VBS%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:KAEMSKP_ERROR_MESSAGE, 'KaemSKP Launcher', 'OK', 'Error') | Out-Null" >nul 2>nul
) else (
  echo.
  echo %KAEMSKP_ERROR_MESSAGE%
  echo.
  echo Tekan tombol apa saja untuk menutup...
  pause >nul
)
set "KAEMSKP_ERROR_MESSAGE="
exit /b 1
