import { getTool } from './catalog.js'

// dispatch(name, input): validate input against the tool schema, run it via the
// injected transport, return the uniform envelope. The transport is the only
// thing that differs per consumer (Tauri invoke in-app, mt-scanner spawn in the
// orchestrator), so the contract stays identical everywhere.

/**
 * Validate an input object against a tool's schema and custom validator.
 * @param {object} tool tool definition
 * @param {object} [input] candidate input
 * @returns {string|null} error message, or null when valid
 */
export function validateInput(tool, input) {
  const data = input ?? {}
  for (const [key, spec] of Object.entries(tool.input)) {
    const value = data[key]
    if (value === undefined || value === null) {
      if (spec.required) return `Missing required field: ${key}`
      continue
    }
    if (spec.type === 'string' && typeof value !== 'string') return `Field "${key}" must be a string`
    if (spec.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) return `Field "${key}" must be an object`
  }
  return tool.validate ? tool.validate(data) : null
}

/**
 * Build a dispatch function bound to a transport.
 * @param {(tool: object, input: object) => unknown} transport runs the tool's backend call
 * @returns {(name: string, input?: object) => Promise<object>} dispatch returning an envelope
 */
export function createDispatch(transport) {
  return async function dispatch(name, input) {
    const tool = getTool(name)
    if (!tool) return { ok: false, error: { code: 'not_found', message: `Unknown tool: ${name}` } }

    const invalid = validateInput(tool, input)
    if (invalid) return { ok: false, error: { code: 'validation', message: invalid } }

    try {
      const output = await transport(tool, input ?? {})
      return { ok: true, output }
    }
    catch (error) {
      return { ok: false, error: { code: 'io', message: String(error?.message ?? error) } }
    }
  }
}
