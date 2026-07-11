---
type: Rust Module
title: main.rs
resource: owner/src-tauri/src/main.rs
docgen:
  crc: 7ca4a2c0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл є точкою входу Tauri-застосунку `owner`: саме тут стартує процес, який показує GUI й під’єднує основну логіку програми до вікна застосунку.

## Поведінка

1. Запускає Tauri-застосунок `owner` і передає керування основній логіці програми.
2. У release-збірці на Windows не відкриває додаткове консольне вікно, щоб користувач працював лише з GUI.
3. Не виконує записів у файлову систему чи базу даних.
4. Не використовує кешування.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
