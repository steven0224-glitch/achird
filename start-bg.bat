@echo off
REM -- Achird Local -- background launcher --------------------------------
REM Starts the server DETACHED and MINIMIZED (a normal minimized console),
REM NOT hidden, then returns immediately.
REM
REM Why: launching with `Start-Process -WindowStyle Hidden` (as ad-hoc
REM automation used to) makes Windows Defender's behavioral engine flag the
REM encoded-PowerShell-spawns-hidden-child pattern as
REM   Trojan:Win32/PowhidSubExec   (Pow=PowerShell, hid=Hidden, SubExec=subprocess).
REM A minimized window is visible to the OS, so the "hidden" signal is gone
REM and the launch is not quarantined.
REM
REM Use this for any automated / Claude-driven start. Humans can double-click
REM run.bat instead (that also opens the browser).
setlocal
start "achird-local" /min "%~dp0run.bat" --no-browser
