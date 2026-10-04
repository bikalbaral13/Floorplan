@echo off
rem Double-click to open the Floorplan local-server window (port, Run, URL).
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0scripts\start-server.ps1"
