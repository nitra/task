---
type: JS Module
title: claims.js
resource: app/src/claims.js
docgen:
  crc: 59aeb5fa
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: best-of-2:retry-won,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд: Оновлює стан вузлів у дереві, використовуючи набір даних, отриманий через `applyClaims`. Вузол отримує статус 'stalled' якщо відповідний заявка закінчилася, або 'running', а також інформацію про виконавця та термін дії лізингу.

## Поведінка

1. Функція applyClaims модифікує надане дерево вузлів.
2. Вона використовує дані з масиву remote_claims для визначення стану кожного вузла.
3. Для кожного вузла у дереві, що має відповідний шлях у remote_claims:
   - Вузол отримує новий стан: 'stalled', якщо відповідний claim позначений як expired, або 'running' в іншому випадку.
   - Вузол отримує поле claim, що містить інформацію про виконавця (actor, runner_id) та термін дії лізингу (lease_until) із відповідного claim.
4. Якщо масив remote_claims порожній, дерево вузлів повертається без змін.
5. Функція повертає те саме дерево вузлів після мутації.

## Публічний API

applyClaims — Накладає claims на вузли дерева, встановлюючи стан `running` або `stalled` та відображуючи деталі claim (`actor`, `runner_id`, `lease_until`).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
