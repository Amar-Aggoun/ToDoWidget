@echo off
echo =========================================
echo   To-Do Widget — Prerequisites Setup
echo =========================================
echo.
echo This script will guide you through installing all
echo required tools to build and run the widget.
echo.

REM ---- Check for winget ----
where winget >nul 2>&1
set HAS_WINGET=%ERRORLEVEL%

echo === Step 1: Install Node.js (v20 LTS) ===
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js is already installed:
    node --version
) else (
    echo [INFO] Node.js not found. Installing via winget...
    if %HAS_WINGET% EQU 0 (
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    ) else (
        echo [ACTION REQUIRED] Download Node.js from: https://nodejs.org/
        echo Install the LTS version, then re-run this script.
        pause
        exit /b 1
    )
)

echo.
echo === Step 2: Install Rust ===
where rustc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Rust is already installed:
    rustc --version
) else (
    echo [INFO] Rust not found.
    echo [INFO] Downloading rustup-init.exe ...
    curl -L -o "%TEMP%\rustup-init.exe" https://win.rustup.rs/x86_64
    echo.
    echo [ACTION REQUIRED] The Rust installer will now open.
    echo    - Choose option 1 (default installation)
    echo    - After installation completes, CLOSE this window
    echo      and open a NEW PowerShell/CMD window, then re-run
    echo      setup.bat to continue.
    echo.
    "%TEMP%\rustup-init.exe"
    echo.
    echo [INFO] If Rust was just installed, please open a NEW terminal window
    echo        and run setup.bat again to continue.
    pause
    exit /b 0
)

echo.
echo === Step 3: Check for Microsoft C++ Build Tools ===
echo [INFO] Checking for cl.exe (MSVC compiler)...
where cl >nul 2>&1
if %ERRORLEVEL% NEq 0 (
    echo.
    echo [ACTION REQUIRED] Microsoft C++ Build Tools are required.
    echo.
    echo Option A (Recommended - Visual Studio Installer):
    echo   1. Open: https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo   2. Download and run the VS Build Tools installer
    echo   3. Select: "Desktop development with C++"
    echo   4. Click Install, wait for completion
    echo   5. Re-run this setup.bat
    echo.
    echo Option B (via winget):
    if %HAS_WINGET% EQU 0 (
        echo    Running: winget install Microsoft.VisualStudio.2022.BuildTools
        winget install Microsoft.VisualStudio.2022.BuildTools ^^
            --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools ^^
            --includeRecommended" ^^
            --accept-package-agreements --accept-source-agreements
    ) else (
        echo    winget not available. Use Option A.
    )
    echo.
    pause
) else (
    echo [OK] MSVC compiler found.
)

echo.
echo === Step 4: Install npm dependencies ===
echo [INFO] Running: npm install
call npm install
if %ERRORLEVEL% NEq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.
echo === Step 5: Generate App Icons ===
echo [INFO] Generating icons from icon.png...
if exist "icon.png" (
    call npm run tauri icon icon.png
    if %ERRORLEVEL% NEq 0 (
        echo [WARN] Icon generation failed. Using placeholder icons.
    ) else (
        echo [OK] Icons generated in src-tauri\icons\
    )
) else (
    echo [WARN] icon.png not found. Using default Tauri icons.
    echo        Place a 512x512 PNG named icon.png in the project root
    echo        and run: npm run tauri icon icon.png
)

echo.
echo =========================================
echo   Setup Complete!
echo.
echo   To run in development mode:
echo     npm run tauri dev
echo.
echo   To build the release .exe:
echo     build_output.bat
echo =========================================
pause
