# Documentation

Specifications for the Dictation web app.

## Contents

1. [Overview](./overview.md) — architecture, modules, end-to-end flows  
2. [Main page](./main-page.md) — single-page UI layout and every control  
3. [Microphone mode](./microphone-mode.md) — mic dictation via Web Speech API  
4. [System audio mode](./system-audio-mode.md) — share screen and loopback + Whisper  
5. [Sessions & storage](./sessions-storage.md) — history panel, IndexedDB, export  
6. [Settings](./settings.md) — language, Whisper model, devices, preferences  
7. [Privacy](./privacy.md) — local vs network behavior  
8. [Deployment](./deployment.md) — Vercel / Netlify static hosting  
9. [VM / Container](../DEPLOYMENT.md) — nginx FrontendGateway scripts  
10. [Changelog](../CHANGELOG.md) — implementation history  

The product is a **single-page application**. There is one interactive “page” (the main workspace). Docs below describe that page’s regions and the functional modes behind them.
