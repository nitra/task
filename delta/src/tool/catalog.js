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
      'Generate (first call) or show (repeat call) the active quiz question for a decision-request variant — ' +
      'writes the mutable NNNN-quiz.md draft. depth: one-tap may mix in a second spaced-repetition question from ' +
      'the personal knowledge base; depth: standard generates 2 questions about the decision itself (M2).',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, chosenOption: CHOSEN_OPTION },
    tauri: 'decision_quiz', // немає прямої Rust-команди — GUI-транспорт (tool/index.js) оркеструє через decision-flow.js
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_approve',
    summary:
      "Submit an answer for the quiz's active question. Wrong: returns the microlesson and layered decision-request " +
      'context ("right to depth", M2), iterations++, no approval written. Right on a non-last question: returns the ' +
      'next question (done: false), still no approval. Right on the last question: finalizes the quiz, records a ' +
      'personal-knowledge-base entry, and writes a signed NNNN-approval.json.',
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
  },
  {
    tier: 'read',
    name: 'knowledge_show',
    summary:
      'Read the personal knowledge base (outside git, next to config.json): per-domain digest ("what I understood, ' +
      'signing") and the private time-to-understanding trend (spec metric #3) — "what the system knows about me" ' +
      'screen (M2).',
    input: {},
    tauri: 'knowledge_show', // немає прямої Rust-команди — GUI-транспорт оркеструє через src/knowledge.js
    cli: true
  },
  {
    tier: 'read',
    name: 'trust_show',
    summary:
      'Derive the "Довіряю" screen: my AI mandates (escalates_to === handle) with track record ("activity and ' +
      'consistency", not a success rate — track-record.js), audacity level + static consequence examples (M3).',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: {
        type: 'string',
        required: false,
        description: 'Owner handle to slice — omitted returns an empty item list.'
      }
    },
    tauri: 'trust_show', // немає прямої Rust-команди — оркеструє src/trust.js + src/track-record.js
    cli: true
  },
  {
    tier: 'write',
    name: 'mandate_narrow',
    summary:
      'Narrow one AI mandate one step (audacity down, or budget_eur ÷2 fallback at the audacity floor) — self-signed ' +
      "by the model's own device key, applied immediately, no quiz-gate (mandates.md: narrowing never needs " +
      'delegator sign-off).',
    input: {
      mandatesDir: MANDATES_DIR,
      ownerHandle: { type: 'string', required: true, description: 'Owner handle of the model mandate to narrow.' }
    },
    tauri: 'mandate_narrow', // оркеструє src/trust.js + src/change-proposal.js: applyMandateNarrow
    cli: true
  },
  {
    tier: 'write',
    name: 'mandate_widen_propose',
    summary:
      'Draft a one-step widen (audacity up, or budget_eur ×1.5 fallback at the audacity ceiling) for one AI mandate ' +
      'and file it as a change-proposal decision-request in the delegator\'s "Вирішую" queue (M1/M2 quiz-gate at ' +
      'forced depth: standard — "last constant", mandates.md).',
    input: {
      mandatesDir: MANDATES_DIR,
      ownerHandle: { type: 'string', required: true, description: 'Owner handle of the model mandate to widen.' },
      initiatedByHandle: {
        type: 'string',
        required: true,
        description: 'Handle of the human who drafted this widen (recommended_by).'
      },
      changeId: {
        type: 'string',
        required: false,
        description: 'Change-proposal id — omitted generates one from the current timestamp.'
      }
    },
    tauri: 'mandate_widen_propose',
    cli: true
  },
  {
    tier: 'write',
    name: 'ai_petition',
    summary:
      'Headless tool simulating a model: drafts a widen of its OWN mandate with evidence from its track record, ' +
      "signs ONLY the petition with the model's device key (never the mandate mutation itself), and files the same " +
      'change-proposal decision-request as mandate_widen_propose (M3, "ШІ-петиція").',
    input: {
      mandatesDir: MANDATES_DIR,
      modelHandle: {
        type: 'string',
        required: true,
        description: 'Handle of the model petitioning for its own mandate widen.'
      },
      changeId: {
        type: 'string',
        required: false,
        description: 'Change-proposal id — omitted generates one from the current timestamp.'
      }
    },
    tauri: 'ai_petition',
    cli: true
  },
  {
    tier: 'read',
    name: 'directory_show',
    summary:
      'Read .mt/directory.json (handle -> {name, email, lang}, PII outside git, M4) — the full admin table for the workspace.',
    input: { mandatesDir: MANDATES_DIR },
    tauri: 'directory_show', // немає прямої Rust-команди — оркеструє src/directory.js над read_text_file
    cli: true
  },
  {
    tier: 'write',
    name: 'directory_set',
    summary:
      "Persist (or update) one handle's display entry in .mt/directory.json — admin-only edit, PII stays out of git.",
    input: {
      mandatesDir: MANDATES_DIR,
      handle: HANDLE,
      name: { type: 'string', required: false, description: 'Display name — omitted leaves the current value.' },
      email: { type: 'string', required: false, description: 'Email — omitted leaves the current value.' },
      lang: {
        type: 'string',
        required: false,
        description: 'Preferred render language (BCP-47-ish tag) — omitted leaves the current value.'
      }
    },
    tauri: 'directory_set',
    cli: true
  },
  {
    tier: 'write',
    name: 'quorum_quiz',
    summary:
      'Multi-signer quorum (M4): generate/show the OWN quiz question for one approver of an irreversible decision-request ' +
      '(leverage_facets.irreversible: true) — depth forced to standard (teach-back is M5), one quiz file per signer handle.',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, signerHandle: HANDLE, chosenOption: CHOSEN_OPTION },
    tauri: 'quorum_quiz',
    cli: true
  },
  {
    tier: 'write',
    name: 'quorum_approve',
    summary:
      "Multi-signer quorum (M4): submit an answer for one approver's own quiz. Right on the last question writes THIS " +
      "signer's own NNNN-approval-{handle}.json — the decision closes only once every approver signed the SAME " +
      'chosen_option (quorum_status shows pending/closed/diverged).',
    input: {
      mandatesDir: MANDATES_DIR,
      runId: RUN_ID,
      nnnn: NNNN,
      signerHandle: HANDLE,
      chosenOption: CHOSEN_OPTION,
      answer: { required: true, description: '0-based quiz option index (number), or the exact option text (string).' }
    },
    tauri: 'quorum_approve',
    cli: true
  },
  {
    tier: 'read',
    name: 'quorum_status',
    summary:
      'Read the quorum state of one irreversible decision-request — who signed, who is pending, closed/diverged.',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN },
    tauri: 'quorum_status',
    cli: true
  },
  {
    tier: 'read',
    name: 'watcher_scan',
    summary:
      'Process watcher (M4): scan open decision-requests for SLA/grace breaches, ping the executor first, escalate to ' +
      "the owner above only after grace (transparent copy stays in the executor's own log), respecting quiet hours " +
      '(irreversible decisions with a deadline are the exception — always delivered).',
    input: { mandatesDir: MANDATES_DIR },
    tauri: 'watcher_scan', // оркеструє src/watcher.js над scan_decisions + read/write_text_file
    cli: true
  },
  {
    tier: 'read',
    name: 'notifications_show',
    summary:
      'Read my own notifications log (.mt/notifications/{handle}.jsonl) — watcher pings and transparent escalation copies addressed to me.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'notifications_show',
    cli: true
  },
  {
    tier: 'read',
    name: 'quiet_hours',
    summary:
      'Read the configured device quiet-hours window ({start, end}, "HH:MM") — null when not configured (watcher/UI never suppress).',
    input: {},
    tauri: 'get_quiet_hours',
    cli: true
  },
  {
    tier: 'write',
    name: 'set_quiet_hours',
    summary:
      'Persist the device quiet-hours window ({start, end}, "HH:MM") — non-critical notifications batch until the window ends.',
    input: {
      start: { type: 'string', required: true, description: 'Window start, "HH:MM".' },
      end: { type: 'string', required: true, description: 'Window end, "HH:MM".' }
    },
    tauri: 'set_quiet_hours',
    cli: true
  },
  {
    tier: 'read',
    name: 'what_system_knows',
    summary:
      'Union-shop screen (M4, constitution p.9): everything the system stores about MY handle — knowledge-base ' +
      'entries/trend, my notifications and watcher pings (and which escalated), registry pubkey. Pure aggregator, no new data collection.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'what_system_knows',
    cli: true
  },
  {
    tier: 'write',
    name: 'mandate_change_apply',
    summary:
      'Finalize a change-proposal AFTER the delegator signed its decision-request via the normal quiz-gate ' +
      '(decision_approve): re-signs the underlying mandate mutation with the SAME device key and applies ' +
      'validate_mandate_change — chosen_option ≠ A (reject), or a non-human signer role, leaves mandates.yaml untouched.',
    input: {
      mandatesDir: MANDATES_DIR,
      changeId: {
        type: 'string',
        required: true,
        description: 'Change-proposal id (runs/mandate-change-{changeId}/decisions/0001-*).'
      },
      handle: {
        type: 'string',
        required: true,
        description: 'Handle of the delegator who signed the decision-request.'
      },
      role: {
        type: 'string',
        required: false,
        description:
          'Signer role for the mandate-change act — "human" (default) or "model" (demo of unconditional rejection).'
      }
    },
    tauri: 'mandate_change_apply',
    cli: true
  }
]
