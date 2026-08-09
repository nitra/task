// Єдине джерело правди tool-поверхні delta-застосунку (n-tool-surface).
// Кожна дія — іменований tool зі схемою, досяжний однаково з UI
// (src/tool/index.js) і headless CLI (bin/delta.mjs): `cli: true` — маркер,
// що обидва входи фактично реалізовані. M1 додає чергу «Вирішую» + квіз-гейт
// + підпис (docs/specs/260809-delta-app.md, п.6 «CLI-паритет») — та сама
// вимога повного паритету, що й у M0 мандатів.

const HANDLE = {
  type: 'string',
  required: true,
  description: 'Owner handle, same format as mandates.yaml owner / h.md assignee.'
}

const MANDATES_DIR = {
  type: 'string',
  required: true,
  description: 'Absolute path to the workspace root (parent of .mt/mandates.yaml and runs/).'
}

const RUN_ID = {
  type: 'string',
  required: true,
  description: 'Run id — file-mock segment of refs/mt/runs/{run-id}/decisions/.'
}

const NNNN = {
  type: 'string',
  required: true,
  description: 'Four-digit decision number, matches NNNN-decision-request.md.'
}

const CHOSEN_OPTION = {
  type: 'string',
  required: true,
  description: 'Decision-request variant label the human is choosing to approve (e.g. "B").'
}

// Trust tier per tool (n-tool-surface D-E1): read < write.
export const TOOLS = [
  {
    tier: 'read',
    name: 'whoami',
    summary: "Read the configured identity handle (null — the 'who are you' step not done yet).",
    input: {},
    tauri: 'get_identity',
    cli: true
  },
  {
    tier: 'write',
    name: 'set_identity',
    summary: 'Persist the identity handle locally (PII stays out of git — mt directory policy).',
    input: { handle: HANDLE },
    tauri: 'set_identity',
    cli: true
  },
  {
    tier: 'read',
    name: 'mandates_dir',
    summary: 'Read the configured workspace root that holds .mt/mandates.yaml.',
    input: {},
    tauri: 'get_mandates_dir',
    cli: true
  },
  {
    tier: 'write',
    name: 'set_mandates_dir',
    summary: 'Persist the workspace root that holds .mt/mandates.yaml.',
    input: {
      dir: { type: 'string', required: true, description: 'Absolute path to the workspace root.' }
    },
    tauri: 'set_mandates_dir',
    cli: true
  },
  {
    tier: 'read',
    name: 'mandates_show',
    summary:
      'Read .mt/mandates.yaml and derive the full forest, the model mandates, and (with handle) the caller slice.',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: { type: 'string', required: false, description: 'Owner handle to slice — omitted skips the slice.' }
    },
    // Транспорт-специфічний: тіло tauri-команди читає лише сирий текст файлу,
    // деривацію (parseMandates/mandatesForOwner/escalationChain) робить
    // спільний мок-парсер src/mandates.js — і в GUI (src/tool/index.js),
    // і в CLI (bin/delta.mjs), щоб обидві поверхні бачили той самий результат.
    tauri: 'read_mandates_yaml',
    cli: true
  },
  {
    tier: 'read',
    name: 'decisions_show',
    summary:
      'Derive the "Вирішую" queue: open decision-request-и (computed_owner === handle), sorted by leverage facets.',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: {
        type: 'string',
        required: false,
        description: 'Owner handle to slice — omitted returns an empty queue.'
      }
    },
    // Той самий патерн, що mandates_show: транспорт читає сирі байти
    // (scan_decisions/fs-скан), деривацію (deriveQueue) робить спільний
    // src/decisions.js — і GUI, і CLI бачать той самий результат.
    tauri: 'scan_decisions',
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_quiz',
    summary:
      'Generate (first call) or show (repeat call) the one-tap quiz question for a decision-request variant — writes the mutable NNNN-quiz.md draft.',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, chosenOption: CHOSEN_OPTION },
    tauri: 'decision_quiz', // немає прямої Rust-команди — GUI-транспорт (tool/index.js) оркеструє через decision-flow.js
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_approve',
    summary:
      'Submit a quiz answer. Wrong: returns the microlesson, iterations++, no approval written. Right: finalizes the quiz and writes a signed NNNN-approval.json.',
    input: {
      mandatesDir: MANDATES_DIR,
      runId: RUN_ID,
      nnnn: NNNN,
      chosenOption: CHOSEN_OPTION,
      answer: { required: true, description: '0-based quiz option index (number), or the exact option text (string).' }
    },
    tauri: 'decision_approve', // те саме — оркестрація в decision-flow.js, Rust лишається fs-шаром
    cli: true
  },
  {
    tier: 'read',
    name: 'device_pubkey',
    summary:
      'Ensure the device Ed25519 keypair exists (generating it on first use) and return its public key (base64).',
    input: {},
    tauri: 'device_pubkey',
    cli: true
  },
  {
    tier: 'read',
    name: 'llm_config',
    summary:
      'Read the local OpenAI-compatible quiz-generator endpoint config (base URL + model), falling back to the built-in default.',
    input: {},
    tauri: 'get_llm_config',
    cli: true
  },
  {
    tier: 'write',
    name: 'set_llm_config',
    summary: 'Persist the local quiz-generator endpoint config (base URL and/or model).',
    input: {
      baseUrl: { type: 'string', required: false, description: 'Base URL of the local OpenAI-compatible endpoint.' },
      model: { type: 'string', required: false, description: 'Model name served by the local endpoint.' }
    },
    tauri: 'set_llm_config',
    cli: true
  }
]
