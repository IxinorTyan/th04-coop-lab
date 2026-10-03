@echo off
cd /d "%~dp0"
echo TH04 input-sync edition - port 9866
python tools/build_lockstep_runtime.py
if errorlevel 1 goto done
python lan_server.py --port 9866
:done
pause
