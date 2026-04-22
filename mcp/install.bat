@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────
::  frontier-advisor-mcp installer (Windows)
:: ─────────────────────────────────────────────

set "REPO_DIR=%~dp0"
set "IMAGE_NAME=mcp/frontier-advisor"
set "ERROR_LOG=%REPO_DIR%install-error.log"

echo.
echo   +-------------------------------------------+
echo   :       frontier-advisor-mcp  setup          :
echo   +-------------------------------------------+
echo.
echo   1)  Docker + mcp-vault     (OS keychain, recommended)
echo   2)  Docker + env vars      (quick start)
echo   3)  Docker MCP Toolkit     (gateway + mcp.json)
echo.
set /p "CHOICE=  Pick an option [1/2/3]: "

if "%CHOICE%"=="1" goto vault
if "%CHOICE%"=="2" goto envvars
if "%CHOICE%"=="3" goto toolkit
echo.
echo   ! Invalid choice. Run this script again.
exit /b 1

:: ── Build ────────────────────────────────────

:build
echo.
echo   Building Docker image...
docker build -t %IMAGE_NAME% "%REPO_DIR%." --quiet >nul 2>>"%ERROR_LOG%"
if errorlevel 1 (
    echo   X Docker build failed. See install-error.log for details.
    echo     Is Docker Desktop running?
    exit /b 1
)
echo   * Image built: %IMAGE_NAME%
exit /b 0

:: ── Option 1: Docker + mcp-vault ─────────────

:vault
call :build
if errorlevel 1 exit /b 1

echo.
where mcp-vault >nul 2>&1
if errorlevel 1 (
    echo   ! mcp-vault not found on PATH.
    echo     Install it from: https://github.com/Shane/mcp-vault
    echo.
)

echo   Store your API keys (at least one):
echo.

set /p "ANTHROPIC_KEY=  Anthropic API key (Enter to skip): "
if defined ANTHROPIC_KEY (
    echo !ANTHROPIC_KEY! | mcp-vault store anthropic/api-key >nul 2>>"%ERROR_LOG%"
    if errorlevel 1 (
        echo   ! Could not store. Run: mcp-vault store anthropic/api-key
    ) else (
        echo   * Stored anthropic/api-key
    )
)

set /p "OPENAI_KEY=  OpenAI API key (Enter to skip): "
if defined OPENAI_KEY (
    echo !OPENAI_KEY! | mcp-vault store openai/api-key >nul 2>>"%ERROR_LOG%"
    if errorlevel 1 (
        echo   ! Could not store. Run: mcp-vault store openai/api-key
    ) else (
        echo   * Stored openai/api-key
    )
)

echo.
echo   Add this to your MCP client config (mcp.json):
echo.
echo     "frontier-advisor": {
echo       "command": "mcp-vault",
echo       "args": [
echo         "--", "docker", "run", "-i", "--rm",
echo         "-e", "ANTHROPIC_API_KEY=vault:anthropic/api-key",
echo         "-e", "OPENAI_API_KEY=vault:openai/api-key",
echo         "mcp/frontier-advisor"
echo       ]
echo     }
echo.
echo   (also saved in mcp.json.example)
goto done

:: ── Option 2: Docker + env vars ──────────────

:envvars
call :build
if errorlevel 1 exit /b 1

echo.
echo   ! Keys in mcp.json are easily leaked when sharing config.
echo     Consider mcp-vault (option 1) to keep them in your OS keychain.
echo.
echo   Add this to your MCP client config (mcp.json):
echo.
echo     "frontier-advisor": {
echo       "command": "docker",
echo       "args": [
echo         "run", "-i", "--rm",
echo         "-e", "ANTHROPIC_API_KEY=^<your-key-here^>",
echo         "mcp/frontier-advisor"
echo       ]
echo     }
goto done

:: ── Option 3: Docker MCP Toolkit ─────────────

:toolkit
call :build
if errorlevel 1 exit /b 1

echo.
docker mcp version >nul 2>>"%ERROR_LOG%"
if errorlevel 1 (
    echo   X Docker MCP plugin not found.
    echo     Update Docker Desktop to 4.62+ and enable MCP Toolkit.
    exit /b 1
)

docker mcp catalog create %IMAGE_NAME% >nul 2>>"%ERROR_LOG%"
docker mcp catalog add %IMAGE_NAME% %IMAGE_NAME% "%REPO_DIR%docker-mcp-catalog.yaml" --force >nul 2>>"%ERROR_LOG%"
if errorlevel 1 (
    echo   X Failed to add catalog. See install-error.log for details.
    exit /b 1
)

docker mcp server enable %IMAGE_NAME% >nul 2>>"%ERROR_LOG%"

echo   * Registered in MCP Toolkit (tools visible via gateway)
echo.
echo   Note: Custom catalog servers don't yet appear in the Desktop UI.
echo   Tools are routed through the gateway to connected clients.
echo.
echo   Add API keys to your MCP client config (mcp.json):
echo.
echo     "frontier-advisor": {
echo       "command": "docker",
echo       "args": [
echo         "run", "-i", "--rm",
echo         "-e", "ANTHROPIC_API_KEY=^<your-key-here^>",
echo         "mcp/frontier-advisor"
echo       ]
echo     }
echo.
echo   Then connect a client:
echo     docker mcp client connect claude
echo     docker mcp client connect cursor
goto done

:: ── Done ─────────────────────────────────────

:done
echo.
echo   Done. See README.md for usage details.
echo.
