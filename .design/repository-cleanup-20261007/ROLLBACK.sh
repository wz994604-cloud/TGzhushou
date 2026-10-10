#!/usr/bin/env pwsh
Set-Location (Split-Path -Parent $PSScriptRoot)
git checkout -- playwright.config.js tests/browser tests/web-chat-refinement.config.js tests/web-function-pages.config.js
npm install
