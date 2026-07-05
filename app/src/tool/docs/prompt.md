---
type: JS Module
title: prompt.js
resource: app/src/tool/prompt.js
docgen:
  crc: 6fbc71ac
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відповідає за генерацію системного промпту за допомогою функції `createSystemPrompt`. Цей промпт визначає ролі, обмеження та інструкції для зовнішніх агентів, що встановлює чіткі межі їхньої роботи.

## Поведінка

1. Викликати `createSystemPrompt` для формування системного промпту, що відображає доступні робочі простори.

## Публічний API

createSystemPrompt — Формує системний промпт, адаптований до специфіки шлюзового агента.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
