#!/bin/bash
cd /workspace/VELCERPA-VER
git add -A
git commit -m "refactor: make index.js Vercel-compatible

- Replace http.createServer+listen with Vercel handler export
- Remove Nezha gRPC (incompatible with serverless)
- Remove systeminformation dep (bundle 30MB->12MB)
- axios timeout 250s->30s
- Update README"
git push origin main