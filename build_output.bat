@echo off
echo =========================================
echo   To-Do Widget -- Build Script
echo =========================================
echo.

REM Check that npm is available
where npm >nul 2>&1
if %ERRORLEVEL% NEq 0 (
    echo [ERROR] npm not found. Run setup.bat first.
    pause
    exit /b 1
)

echo [1/3] Building Tauri NSIS installer...
call npm run tauri build
if %ERRORLEVEL% NEq 0 (
    echo.
    echo [ERROR] Build failed. Check the output above for errors.
    pause
    exit /b 1
)

echo.
echo [2/3] Creating output directory...
if not exist "output" mkdir output

echo.
echo [3/3] Copying NSIS installer to output\ ...

REM Tauri places the NSIS setup .exe in: src-tauri\target\release\bundle\nsis\
REM File is named like: ToDoWidget_1.0.0_x64-setup.exe
set NSIS_DIR=src-tauri\target\release\bundle\nsis
set FOUND=0

for %%f in ("%NSIS_DIR%\*setup.exe") do (
    echo Found: %%f
    copy /Y "%%f" "output\ToDoWidget-Setup.exe" >nul
    set FOUND=1
    goto :done
)

:done
if "%FOUND%"=="0" (
    echo [WARN] NSIS installer not found. Falling back to portable binary...
    copy /Y "src-tauri\target\release\todo-widget.exe" "output\ToDoWidget.exe" >nul 2>&1
    if %ERRORLEVEL% NEq 0 (
        echo [ERROR] Could not find any compiled output.
        pause
        exit /b 1
    )
    echo.
    echo =========================================
    echo   BUILD SUCCESSFUL (portable .exe)
    echo   File: output\ToDoWidget.exe
    echo =========================================
) else (
    echo.
    echo =========================================
    echo   BUILD SUCCESSFUL!
    echo.
    echo   Installer: output\ToDoWidget-Setup.exe
    echo.
    echo   End users run this one file to install.
    echo   No admin rights required (user-level).
    echo   Creates desktop + Start Menu shortcuts.
    echo   Includes uninstaller via Control Panel.
    echo =========================================
)
pause
