@echo off
cd /d "%~dp0"
echo TH04 input-sync edition - port 9866
python lan_server.py --port 9866
pause
