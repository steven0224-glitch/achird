@echo off
setlocal
cd /d "%~dp0"

REM venv lives on the local disk (LOCALAPPDATA) to avoid OneDrive sync churn.
REM If a .venv exists inside the app folder, it is used as-is.
set "VENV=%~dp0.venv"
if not exist "%VENV%\Scripts\python.exe" set "VENV=%LOCALAPPDATA%\achird-local\venv"

if not exist "%VENV%\Scripts\python.exe" (
    echo [Achird] First run: creating venv and installing dependencies...
    python -m venv "%VENV%" || goto :nopython
)

REM self-heal: if a previous run was interrupted mid-install, finish it
REM python-docx is optional: only the .docx export needs it. If it is missing the app
REM still runs and that one button reports why - the install must not become a wall.
"%VENV%\Scripts\python.exe" -c "import fastapi, uvicorn, multipart, docx, pypdf" 2>nul || (
    echo [Achird] Installing dependencies...
    "%VENV%\Scripts\python.exe" -m pip install --quiet fastapi uvicorn python-multipart python-docx pypdf || goto :piperr
)

"%VENV%\Scripts\python.exe" app.py %*
goto :eof

:nopython
echo.
echo [ERROR] python not found. Install Python 3.10+ from https://python.org
echo         and check "Add python.exe to PATH" during install.
pause
goto :eof

:piperr
echo.
echo [ERROR] dependency install failed. Check your network connection.
pause
