---
type: JS Module
title: index.js
resource: delta/src/tool/index.js
docgen:
  crc: b10119d9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 60
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

GUI tool-dispatch поверхня для Tauri: збирає TOOL-обробники і прокидує їх у спільний transport без зміни поведінки викликів.

## Публічний API

- dispatch — Експортує dispatch для GUI tool-поверхні на базі TOOLS і transport.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
