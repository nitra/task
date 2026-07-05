---
type: ADR
title: MCP-stdio keep-alive до закриття зʼєднання
description: MCP-гілка task mcp не завершує процес одразу після server.connect і живе до EOF stdin.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

У режимі `task mcp` після `await server.connect(new StdioServerTransport())` виконання повертало `0`, а `main().then(process.exit)` одразу завершував процес. Через це MCP-сервер міг вийти відразу після підключення клієнта, ще до обробки запитів.

## Considered Options

- Створити `new Promise` і вручну чекати `onclose`.
- Не викликати `process.exit` для MCP-гілки: повертати `undefined`, а `process.exit` виконувати лише для числового exit code.

## Decision Outcome

Chosen option: "Не викликати `process.exit` для MCP-гілки", because stdin Stdio transport сам тримає event loop живим до EOF клієнта, а варіант з ручним Promise створював ESLint-порушення `unicorn/no-new-promise` і `unicorn/prefer-add-event-listener`.

### Consequences

- Good, because smoke-тест після фіксу показав `TOOLS: request, respond`, `STATUS: done` і створену задачу на диску.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because MCP-гілка тепер повертає `undefined`, а wrapper завершує процес лише коли code не `undefined`.

## More Information

Файл: `app/bin/task.mjs`. Зміна: MCP-гілка повертає `undefined`; `main().then((code) => { if (code !== undefined) process.exit(code) })`. Коміти в transcript: `0b6afee` для початкової реалізації та `54130b4` для keep-alive фіксу.
