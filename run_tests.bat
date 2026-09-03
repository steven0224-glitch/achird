@echo off
setlocal
cd /d "%~dp0"

REM Same venv rule as run.bat - test on the interpreter the app actually runs on.
set "VENV=%~dp0.venv"
if not exist "%VENV%\Scripts\python.exe" set "VENV=%LOCALAPPDATA%\achird-local\venv"
if not exist "%VENV%\Scripts\python.exe" (
    echo [ERROR] venv not found. Run run.bat once first.
    pause
    goto :eof
)

"%VENV%\Scripts\python.exe" run_tests.py
echo.
pause
