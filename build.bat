@echo off
title Modpack Tool Builder
color 0A
echo ===================================================
echo               MODPACK TOOL BUILDER
echo ===================================================
echo.
echo [1/3] Cleaning previous build artifacts...
if exist dist rd /s /q dist
if exist out rd /s /q out

echo.
echo [2/3] Compiling TypeScript and bundling Vite assets...
call npm run typecheck
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] TypeCheck failed! Aborting build.
    pause
    exit /b %errorlevel%
)

echo.
echo [3/3] Packaging Windows Executables via electron-builder...
call npm run build:win
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Packaging failed! Aborting build.
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo  SUCCESS! Executables built in the \dist\ folder.
echo ===================================================
echo.
pause
