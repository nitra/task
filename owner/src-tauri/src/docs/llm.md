---
type: Rust Module
title: llm.rs
resource: owner/src-tauri/src/llm.rs
docgen:
  crc: 6bab36d5
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає два незалежні Tauri-входи `llm_one_shot` і `llm_one_shot_acp` до crate `llm-cascade`. Він існує як тонкий транспортний шар без власного вибору fallback між ACP, local і cloud.

## Поведінка

`llm_one_shot` і `llm_one_shot_acp` є незалежними Tauri-входами до `owner-llm`: вони приймають дані з виклику Tauri, передають їх у відповідний імпортований LLM-виклик і повертають результат назад у виклик Tauri.

Файл не обирає fallback-порядок між ACP, local і cloud. Це рішення залишається поза цим файлом.

Спільного стану між `llm_one_shot` і `llm_one_shot_acp` тут немає: обидва виклики працюють як тонкий транспортний шар без власних записів у файлову систему чи базу даних.

## Публічний API

- `llm_one_shot` — тонка `tauri::command`-обгортка над `owner-llm` для одиночного запиту до LLM без власної LLM-логіки в цьому файлі.
- `llm_one_shot_acp` — тонка `tauri::command`-обгортка над `owner-llm` для альтернативної одиночної точки входу.
- `llm_one_shot` і `llm_one_shot_acp` — дві незалежні точки входу `llm-cascade`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
