@echo off
cd /d "%~dp0"
echo TH04 direct IPv6 WebSocket host - port 9866
echo Open from the Internet:
echo http://[YOUR-PUBLIC-IPV6]:9866/lan.html?network=direct-ws^&rollback=off
echo Configure router/firewall TCP 9866 before sharing the URL.
python tools/build_lockstep_runtime.py
if errorlevel 1 goto done
python lan_server.py --bind :: --port 9866
:done
pause
