import { TOOLS } from './catalog.js'

// Consumer-facing artifacts derived from the single tool catalog. The LLM
// adapter (omlx — OpenAI-compatible MLX server) consumes the OpenAI
// function-calling shape; an MCP wrapper over the same catalog is the next step.

/**
 * Convert a tool input spec into a JSON Schema object.
 * @param {Record<string, {type: string, required?: boolean, description?: string}>} input tool input spec
 * @returns {object} JSON Schema for the parameters object
 */
function toJsonSchema(input) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(input)) {
    properties[key] = spec.description ? { type: spec.type, description: spec.description } : { type: spec.type }
    if (spec.required) required.push(key)
  }
  return required.length ? { type: 'object', properties, required } : { type: 'object', properties }
}

/**
 * OpenAI function-calling tool definitions for every catalog tool.
 * @returns {object[]} OpenAI `tools` array
 */
export function toolManifest() {
  return TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.summary,
      parameters: toJsonSchema(tool.input),
    },
  }))
}

/**
 * Compact catalog listing (name + summary) for `task list`.
 * @returns {{name: string, summary: string}[]} tool list
 */
export function listTools() {
  return TOOLS.map(({ name, summary }) => ({ name, summary }))
}
