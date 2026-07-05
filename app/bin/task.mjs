#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID as _uuid } from 'node:crypto'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  createAgentKit,
  createDispatch,
  createOpenAiChat,
  listTools,
  runAgent,
  toolManifest
} from '@7n/tauri-components'
import { TOOLS } from '../src/tool/catalog.js'
import { createNodeJournalStore } from '../src/tool/journal-store-node.js'
import { createSystemPrompt } from '../src/tool/prompt.js'

// Headless entry for script orchestrators (n-tool-surface): no human-facing
// verbs/flags — just `task <tool> '<json>'`, `task schema`, `task list`. Same
// tool catalog as the UI; the only difference is the transport (per-verb spawn
// of the mt-scanner binary). Output is the uniform envelope as JSON on stdout.

const BIN_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the mt-scanner binary: env override, then dev build dirs.
 * @returns {string} absolute path to the binary
 */
function resolveScannerBin() {
  if (process.env.MT_SCANNER_BIN) return process.env.MT_SCANNER_BIN
  const candidates = [
    // mt is a cargo workspace → binary lands in the workspace target dir
    join(BIN_DIR, '../../../mt/target/release/mt-scanner'),
    join(BIN_DIR, '../../../mt/target/debug/mt-scanner'),
    // fallback: standalone (non-workspace) layout
    join(BIN_DIR, '../../../mt/scanner/target/release/mt-scanner'),
    join(BIN_DIR, '../../../mt/scanner/target/debug/mt-scanner')
  ]
  const found = candidates.find(path => existsSync(path))
  if (found) return found
  throw new Error('mt-scanner not found; set MT_SCANNER_BIN or run `cargo build --release` in mt/scanner')
}

/**
 * The user's configured project paths (single source, written by the GUI/Rust);
 * defaults to ~/www. Lets the MCP agent ground against the SAME roots as the human.
 * @returns {string[]} project paths
 */
function readProjectPaths() {
  try {
    const cfg = join(process.env.HOME ?? '', 'Library/Application Support/com.nitra.task/config.json')
    const paths = JSON.parse(readFileSync(cfg, 'utf8')).project_paths
    if (Array.isArray(paths) && paths.length) return paths
  } catch {
    // no config yet — fall through to default
  }
  const www = join(process.env.HOME ?? '', 'www')
  return existsSync(www) ? [www] : []
}

/**
 * CLI transport: spawn mt-scanner per tool, parse JSON stdout. `workspaces`
 * scans the configured project paths (multi-root); others use `tool.cli`.
 * @param {object} tool tool definition (uses `tool.name` / `tool.cli`)
 * @param {object} input tool input
 * @returns {unknown} parsed JSON output (or null when empty)
 */
function cliTransport(tool, input) {
  // workspaces scans the configured project paths (multi-root) — same source as
  // the GUI; scan/create take an absolute tasksDir so they need no cwd.
  const argv = tool.name === 'workspaces' ? ['workspaces', ...readProjectPaths()] : tool.cli(input)
  const result = spawnSync(resolveScannerBin(), argv, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `mt-scanner exited ${result.status}`)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

const dispatch = createDispatch(TOOLS, cliTransport)

/**
 * @returns {Promise<number>} process exit code
 */
async function main() {
  const [cmd, payload] = process.argv.slice(2)

  if (!cmd || cmd === 'list') {
    process.stdout.write(`${JSON.stringify(listTools(TOOLS), null, 2)}\n`)
    return 0
  }
  if (cmd === 'schema') {
    process.stdout.write(`${JSON.stringify(toolManifest(TOOLS), null, 2)}\n`)
    return 0
  }

  if (cmd === 'agent') {
    if (!payload) {
      process.stderr.write('usage: task agent "<prompt>"\n')
      return 2
    }
    const baseUrl = process.env.OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1'
    const model = process.env.OMLX_MODEL ?? 'mlx-community/gemma-3n-E4B-it'
    const apiKey = process.env.OMLX_API_KEY
    try {
      const result = await runAgent({
        prompt: payload,
        dispatch,
        chat: createOpenAiChat({ baseUrl, model, apiKey }),
        system: createSystemPrompt(),
        tools: toolManifest(TOOLS)
      })
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`agent failed (omlx ${baseUrl}, model ${model}): ${String(error?.message ?? error)}\n`)
      process.stderr.write('Set OMLX_BASE_URL / OMLX_MODEL, and ensure the omlx server is running.\n')
      return 2
    }
  }

  if (cmd === 'mcp') {
    // MCP-stdio server — exposes request(intent) and respond(requestId, message)
    // so any MCP-capable orchestrator (Claude Code, Cursor) can drive the app agent.
    const actorId =
      process.env.MCP_ACTOR_ID ??
      (() => {
        const flag = process.argv.indexOf('--actor')
        return flag === -1 ? 'mcp-' + _uuid().slice(0, 8) : process.argv[flag + 1]
      })()
    const actor = { kind: 'agent', id: actorId }

    const baseUrl = process.env.OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1'
    const model = process.env.OMLX_MODEL ?? 'gemma-4-e4b-it-OptiQ-4bit'
    const apiKey = process.env.OMLX_API_KEY
    const chat = createOpenAiChat({ baseUrl, model, apiKey })

    // Journal FS through the Rust `journal` binary (FS-in-Rust). NODE_REQUESTS_DIR
    // overrides the dir (tests); else the binary uses the app-local-data default.
    const journal = createNodeJournalStore({ requestsDir: process.env.NODE_REQUESTS_DIR })

    // Bind the shared agent kit to this app's catalog + domain prompt, the CLI
    // transport and the node journal. Grounded with the workspace list.
    const kit = createAgentKit({
      catalog: TOOLS,
      systemPrompt: ctx => createSystemPrompt(ctx.workspaces),
      transport: cliTransport,
      journal,
      grounding: { tool: 'workspaces', key: 'workspaces' }
    })

    const server = new Server({ name: 'task', version: '1.0.0' }, { capabilities: { tools: {} } })

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: 'request',
          description:
            'Send a natural-language intent to the task-app agent. Returns a structured result with status, summary, actions taken, and an optional clarifying question.',
          inputSchema: {
            type: 'object',
            properties: { intent: { type: 'string', description: 'What you want the agent to do.' } },
            required: ['intent']
          }
        },
        {
          name: 'respond',
          description:
            'Reply to a pending clarification (needs_clarification status). Pass the requestId from the previous request call.',
          inputSchema: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              message: { type: 'string', description: 'Your answer to the clarifying question.' }
            },
            required: ['requestId', 'message']
          }
        }
      ]
    }))

    server.setRequestHandler(CallToolRequestSchema, async req => {
      const { name, arguments: args } = req.params
      let result
      if (name === 'request') {
        result = await kit.request({ intent: args.intent, actor, chat })
      } else if (name === 'respond') {
        result = await kit.respond({ requestId: args.requestId, message: args.message, actor, chat })
      } else {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool: ' + name }) }], isError: true }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    })

    await server.connect(new StdioServerTransport())
    // Return null (not a code) so main()'s dispatcher does NOT call
    // process.exit — that would kill the server right after connecting. The
    // stdio transport keeps stdin open (active handle), so the process stays
    // alive serving requests and exits naturally on stdin EOF / disconnect.
    return null
  }

  let input = {}
  if (payload) {
    try {
      input = JSON.parse(payload)
    } catch {
      process.stderr.write(`Invalid JSON input: ${payload}\n`)
      return 2
    }
  }

  const envelope = await dispatch(cmd, input)
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  return envelope.ok ? 0 : 2
}

main()
  .then(code => {
    // null = long-running mode (MCP server) — let the process live on its own handles.
    if (code !== null) process.exit(code)
  })
  .catch(error => {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exit(1)
  })
