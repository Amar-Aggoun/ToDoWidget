@echo off
echo =========================================
echo   To-Do Widget — GitHub Push Script
echo =========================================
echo.

REM Check git
where git >nul 2>&1
if %ERRORLEVEL% NEq 0 (
    echo [ERROR] Git not found.
    echo Download from: https://git-scm.com/download/win
    pause
    exit /b 1
)

REM Initialize git repo if needed
if not exist ".git" (
    echo [1/5] Initializing Git repository...
    git init
    git checkout -b main
) else (
    echo [1/5] Git repository already initialized.
)

REM Stage all files
echo.
echo [2/5] Staging all files...
git add .

REM Commit
echo.
echo [3/5] Creating commit...
git diff --cached --quiet
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Nothing to commit. Working tree is clean.
) else (
    git commit -m "Initial release: ToDoWidget v1.0.0"
)

REM Get GitHub URL
echo.
set /p REPO_URL="[4/5] Enter your GitHub repo URL (e.g. https://github.com/user/repo.git): "
if "%REPO_URL%"=="" (
    echo [ERROR] No URL provided.
    pause
    exit /b 1
)

REM Add remote (if not already added)
git remote get-url origin >nul 2>&1
if %ERRORLEVEL% NEq 0 (
    git remote add origin %REPO_URL%
) else (
    git remote set-url origin %REPO_URL%
)

REM Push
echo.
echo [5/5] Pushing to GitHub...
git push -u origin main
if %ERRORLEVEL% NEq 0 (
    echo.
    echo [ERROR] Push failed.
    echo Make sure you are authenticated with GitHub.
    echo Try: git config --global credential.helper manager
    pause
    exit /b 1
)

echo.
echo =========================================
echo   Successfully pushed to GitHub!
echo   URL: %REPO_URL%
echo =========================================
pause
