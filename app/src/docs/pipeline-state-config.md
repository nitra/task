---
type: JS Module
title: pipeline-state-config.js
resource: app/src/pipeline-state-config.js
docgen:
  crc: da722ad8
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min-retry
  score: 100
---

## Огляд

Огляд: Файл визначає константи кольорів та міток для станів прогону пайплайну, а також визначає візуальну конфігурацію для прогону, надаючи перевагу `conclusion` і повертаючи `status` як резервний варіант

## Поведінка

Поведінка
PIPELINE_STATE_CONFIG створює константу з іконами кольорами та мітками для різних станів прогону пайплайну.
FALLBACK_PIPELINE_STATE повертає конфігурацію стану 'no_runs'.
pipelineStateConfig визначає візуальну конфігурацію для прогону пайплайну, надаючи перевагу `conclusion` та повертаючи `status` як запасний варіант.

## Публічний API

Назва — що робить.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
