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
    // Фаза A: Rust-команда РОБИТЬ парсинг/валідацію (mt_mandates) і
    // деривацію (mandatesForOwner/escalationChain/modelMandates) через
    // delta-core — і GUI (Tauri-команда delta/src-tauri/src/phase_a.rs:
    // mandates_show), і CLI (delta-cli), той самий crate.
    tauri: 'mandates_show',
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
    // Фаза A: той самий патерн, що mandates_show — Rust-команда деривує
    // чергу (delta_core::decisions::derive_queue) напряму, GUI/CLI бачать
    // той самий результат з того самого crate.
    tauri: 'decisions_show',
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_quiz',
    summary:
      'Generate (first call) or show (repeat call) the active quiz gate for a decision-request variant — writes the ' +
      'mutable NNNN-quiz.md draft. depth: one-tap may mix in a second spaced-repetition question from the personal ' +
      'knowledge base; depth: standard generates 2 questions about the decision itself (M2); depth: teach-back ' +
      '(irreversible / wide blast_radius, M5) has no question — returns a `prompt` asking the owner to retell the ' +
      'decision in their own words (decision_approve takes `transcript`, not `answer`). Trust-simplification (p.3): ' +
      '5 consecutive clean quizzes (iterations=1) of the same domain, same mandate generation, last ≤14 days ago ' +
      'collapses a `standard` quiz to one question — `trustSimplified: true` in both the response and the quiz-file ' +
      "frontmatter. growth_edge (p.2г): if the decision's domain is in the owner's .mt/profiles/{handle}.yaml " +
      'growth_edge, an OPTIONAL, non-blocking `growthEdge` field is attached — a broader-context "stretch" question ' +
      'that never enters the quiz file and never raises signing requirements.',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, chosenOption: CHOSEN_OPTION },
    tauri: 'decision_quiz', // фаза A: пряма Rust-команда (delta-core::decision_flow), той самий crate, що CLI
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_approve',
    summary:
      "Submit an answer (Q&A depths) or a transcript (depth: teach-back, M5) for the quiz's active question/prompt. " +
      'Wrong / not-understood: returns feedback and layered decision-request context ("right to depth", M2), ' +
      'iterations++, no approval written. Right on a non-last question: returns the next question (done: false), ' +
      'still no approval. Right / understood on the last step: finalizes the quiz, records a personal-knowledge-base ' +
      'entry, and writes a signed NNNN-approval.json. teach-back with the local model unavailable returns ' +
      '`available: false` — an honest refusal, NOT a fallback to a lower depth; the decision stays open.',
    input: {
      mandatesDir: MANDATES_DIR,
      runId: RUN_ID,
      nnnn: NNNN,
      chosenOption: CHOSEN_OPTION,
      answer: {
        required: false,
        description:
          '0-based quiz option index (number), or the exact option text (string) — Q&A depths (one-tap/standard).'
      },
      transcript: {
        type: 'string',
        required: false,
        description:
          "Retell of the decision and its consequences in the owner's own words — depth: teach-back only (M5)."
      }
    },
    tauri: 'decision_approve', // фаза A: пряма Rust-команда (delta-core::decision_flow), той самий crate, що CLI
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
    tauri: 'knowledge_show', // фаза B: пряма Rust-команда (delta-core::knowledge), той самий crate, що CLI
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
    tauri: 'trust_show', // фаза A: пряма Rust-команда (delta-core::trust + track_record), той самий crate, що CLI
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
    tauri: 'mandate_narrow', // фаза A: пряма Rust-команда (delta-core::change_proposal::apply_mandate_narrow), той самий crate, що CLI
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
    tauri: 'directory_show', // фаза B: пряма Rust-команда (delta-core::directory), той самий crate, що CLI
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
      'Multi-signer quorum (M4/M5): generate/show the OWN teach-back prompt for one approver of an irreversible ' +
      'decision-request (leverage_facets.irreversible: true) — depth: teach-back (M5, no longer forced to standard), ' +
      'one quiz file per signer handle; each signer writes their OWN transcript (quorum_approve).',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, signerHandle: HANDLE, chosenOption: CHOSEN_OPTION },
    tauri: 'quorum_quiz',
    cli: true
  },
  {
    tier: 'write',
    name: 'quorum_approve',
    summary:
      "Multi-signer quorum (M4/M5): submit one approver's OWN teach-back transcript. Understood on evaluation writes " +
      "THIS signer's own NNNN-approval-{handle}.json — the decision closes only once every approver signed the SAME " +
      'chosen_option (quorum_status shows pending/closed/diverged). Local model unavailable returns `available: ' +
      'false` — honest refusal, no fallback depth.',
    input: {
      mandatesDir: MANDATES_DIR,
      runId: RUN_ID,
      nnnn: NNNN,
      signerHandle: HANDLE,
      chosenOption: CHOSEN_OPTION,
      transcript: {
        type: 'string',
        required: true,
        description: "This signer's own retell of the decision and its consequences, in their own words."
      }
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
    tauri: 'watcher_scan', // фаза B: пряма Rust-команда (delta-core::watcher), той самий crate, що CLI
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
  },
  {
    tier: 'read',
    name: 'simulate_mandate_scope',
    summary:
      'Simulation on history (constitution p.12): deterministic, no LLM — scans runs/*/decisions over periodDays ' +
      '(default 90), counts how many would fall into decisionTypes (bucketed per type, with an irreversible ' +
      "sub-count). excludeDecisionTypes (the mandate's CURRENT scope, if any) subtracts decisions that already " +
      'matched before the change — leaving only newly-captured ones. Matches ONLY the decision_types axis — ' +
      'decision-request mock has no field equivalent to scope.refs (documented scope limit, docs/open-questions.md).',
    input: {
      mandatesDir: MANDATES_DIR,
      decisionTypes: {
        type: 'array',
        required: true,
        description: 'Requested/current scope.decision_types to simulate.'
      },
      excludeDecisionTypes: {
        type: 'array',
        required: false,
        description: 'Previous scope.decision_types — omitted counts everything matching decisionTypes.'
      },
      periodDays: { type: 'number', required: false, description: 'Lookback window in days — omitted defaults to 90.' }
    },
    tauri: 'simulate_mandate_scope',
    cli: true
  },
  {
    tier: 'write',
    name: 'mandate_request_propose',
    summary:
      'Онбординг = перший мандат (constitution p.10): builds a minimal-mandate template for a NEW handle (absent ' +
      'from mandates.yaml) and files it as a change-proposal decision-request in the DELEGATOR\'s "Вирішую" queue — ' +
      'same ChangeKind::Added path mt_mandates::validate_mandate_change uses for widening an AI mandate ' +
      '(mandate_widen_propose). The delegator then signs via the normal decision_quiz/decision_approve + ' +
      'mandate_change_apply — no new signing path.',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: { type: 'string', required: true, description: 'The new handle requesting its first mandate.' },
      delegatorHandle: {
        type: 'string',
        required: true,
        description: 'Existing owner (root or otherwise) who will sign this new entry.'
      },
      initiatedByHandle: {
        type: 'string',
        required: false,
        description: 'Handle recorded as recommended_by — omitted defaults to handle (self-request).'
      },
      kind: {
        type: 'string',
        required: false,
        description: '"person" (default) | "model".'
      },
      refs: {
        type: 'array',
        required: true,
        description: 'Requested scope.refs — non-empty (mt_mandates rejects empty).'
      },
      decisionTypes: {
        type: 'array',
        required: true,
        description: 'Requested scope.decision_types — non-empty (mt_mandates rejects empty).'
      },
      changeId: {
        type: 'string',
        required: false,
        description: 'Change-proposal id — omitted defaults to "onboarding-{handle}".'
      },
      reason: {
        type: 'string',
        required: false,
        description: 'Recommendation text — omitted uses a default onboarding message.'
      }
    },
    tauri: 'mandate_request_propose',
    cli: true
  },
  {
    tier: 'read',
    name: 'onboarding_status',
    summary:
      'Whether `handle` still needs onboarding (constitution p.10): absent from mandates.yaml (needsOnboarding), and ' +
      'whether the entry-quiz on the mandate it just received is completed (entryQuizComplete). ' +
      'onboardingComplete = both steps done.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'onboarding_status',
    cli: true
  },
  {
    tier: 'write',
    name: 'entry_quiz_start',
    summary:
      'Онбординг crypto п.10 step (г): generate (first call) or show (repeat call, no regeneration) three ' +
      'deterministic questions about the mandate `handle` JUST received (budget threshold / escalates_to / ' +
      'decision_types) — writes runs/onboarding-{handle}/entry-quiz.md. Requires the mandate to already be in ' +
      'mandates.yaml (mandate_change_apply already ran).',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'entry_quiz_start',
    cli: true
  },
  {
    tier: 'write',
    name: 'entry_quiz_submit',
    summary:
      'Онбординг п.10 step (г): submit all three entry-quiz answers at once (0-based option index per question, ' +
      'in order). All correct → writes entry-quiz-complete.json (onboarding fully done). Any wrong → fail ≠ ' +
      'punishment: same questions stay, iterations grows, results shows which ones missed with a microlesson.',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: HANDLE,
      answers: { type: 'array', required: true, description: 'One 0-based option index per question, in order.' }
    },
    tauri: 'entry_quiz_submit',
    cli: true
  },
  {
    tier: 'read',
    name: 'profile_show',
    summary:
      'Profile mock (p.2г, mandates.md "growth_edge — the ONE section the person writes themselves"): read ' +
      '.mt/profiles/{handle}.yaml growth_edge — missing/corrupt file returns an empty list, not an error.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'profile_show',
    cli: true
  },
  {
    tier: 'write',
    name: 'profile_set_growth_edge',
    summary:
      "Persist the FULL growth_edge list for `handle` — the person's own self-declared domains to grow into, read " +
      'by decision_quiz to attach an optional non-blocking "stretch" question of the same domain.',
    input: {
      mandatesDir: MANDATES_DIR,
      handle: HANDLE,
      growthEdge: { type: 'array', required: true, description: 'Full replacement list of domain strings.' }
    },
    tauri: 'profile_set_growth_edge',
    cli: true
  },
  {
    tier: 'read',
    name: 'decision_brief',
    summary:
      'Штаб (M5): lazily compress a decision-request into a brief — 3-sentence context, one price line per option, ' +
      'recommendation + the STRONGEST objection against it (anti-rubber-stamping, owner-spec «Штаб»), cost of ' +
      'delay. LLM unavailable — honest structural fallback (frontmatter + headings, no compression, no objection).',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN },
    tauri: 'decision_brief', // фаза B: пряма Rust-команда (delta-core::staff), той самий crate, що CLI
    cli: true
  },
  {
    tier: 'write',
    name: 'ai_candor',
    summary:
      'Headless tool simulating a model (M5, "незручна правда" pattern — mirrors ai_petition): appends a candor ' +
      "record {from_model, statement, evidence_refs, audacity_level, created_at} to the ADDRESSEE's SEPARATE " +
      '.mt/candor/{handle}.jsonl inbox (never mixed into the decisions queue). audacity_level is validated against ' +
      "the sender model's mandate audacity budget — rejected if it exceeds it.",
    input: {
      mandatesDir: MANDATES_DIR,
      toHandle: {
        type: 'string',
        required: true,
        description: 'Handle who should hear this — the candor inbox owner.'
      },
      fromModelHandle: {
        type: 'string',
        required: true,
        description: 'Handle of the model (kind: model) sending the candor.'
      },
      statement: { type: 'string', required: true, description: 'The uncomfortable truth itself.' },
      evidenceRefs: {
        type: 'array',
        required: false,
        description: 'References backing the statement (decision-refs, quiz-refs, ...).'
      },
      audacityLevel: {
        type: 'string',
        required: true,
        description: '"low" | "medium" | "high" — validated against the mandate budget.'
      }
    },
    tauri: 'ai_candor',
    cli: true
  },
  {
    tier: 'read',
    name: 'candor_show',
    summary:
      'Read my "незручна правда" inbox (.mt/candor/{handle}.jsonl) — separate from the decisions queue, with local (private) read marks.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'candor_show', // фаза B: пряма Rust-команда (delta-core::candor), той самий crate, що CLI
    cli: true
  },
  {
    tier: 'write',
    name: 'candor_mark_read',
    summary:
      'Mark one candor record as read — LOCAL to this device only (candor_read.json, outside git; never synced/shared).',
    input: { id: { type: 'string', required: true, description: 'Candor record id (candorShow()[].id).' } },
    tauri: 'candor_mark_read',
    cli: true
  },
  {
    tier: 'write',
    name: 'drift_scan',
    summary:
      'Private mirror (M5, constitution p.6): scans MY open decision-requests for systematic postponement (stale ' +
      'past a threshold, or repeated quiz iterations without signing), grouped by decision_type. Cards are stored ' +
      'LOCALLY outside git (next to knowledge.json) — NEVER in the shared .mt/notifications log; visible to the ' +
      'owner ONLY. Each scan overwrites the local file with a fresh result.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'drift_scan', // фаза B: пряма Rust-команда (delta-core::drift), той самий crate, що CLI
    cli: true
  },
  {
    tier: 'read',
    name: 'drift_show',
    summary: 'Read the locally persisted drift cards from the last drift_scan (outside git, owner-private).',
    input: {},
    tauri: 'drift_show',
    cli: true
  },
  {
    tier: 'write',
    name: 'delegation_quiz',
    summary:
      'Deferred-action queue (M5): generate/show the ONE deterministic one-tap meta-question for delegating a ' +
      'decision-request to a model ("what exactly are you delegating and what will the model do") — writes ' +
      'NNNN-delegation-quiz.md, no LLM involved (the correct answer has a fixed shape regardless of domain).',
    input: { mandatesDir: MANDATES_DIR, runId: RUN_ID, nnnn: NNNN, modelHandle: HANDLE },
    tauri: 'delegation_quiz',
    cli: true
  },
  {
    tier: 'write',
    name: 'decision_delegate',
    summary:
      'Deferred-action queue (M5): submit the delegation meta-quiz answer. Right answer signs and writes ' +
      'NNNN-delegation.json {delegated_to, delegated_by, signed_at, pubkey, signature, quiz_ref} — the ' +
      'decision-request itself is NEVER mutated (computed_owner stays put); presence of the delegation file is a ' +
      "derived signal that moves the item from the delegator's queue into the model's (decisions_show).",
    input: {
      mandatesDir: MANDATES_DIR,
      runId: RUN_ID,
      nnnn: NNNN,
      modelHandle: { type: 'string', required: true, description: 'Handle of the model the decision is delegated to.' },
      delegatedByHandle: {
        type: 'string',
        required: true,
        description: 'Handle of the human delegating (directorial responsibility stays with them).'
      },
      answer: { required: true, description: '0-based quiz option index (number), or the exact option text (string).' }
    },
    tauri: 'decision_delegate',
    cli: true
  },
  {
    tier: 'write',
    name: 'delta_report',
    summary:
      'M6 pilot metric: deterministic (no LLM) delta-report over a window (default 7 days) — boundary moves (applied ' +
      'mandate-changes, runs/mandate-change-*/0001-applied.json), decisions closed (human/model/quorum, by ' +
      'decision_type), gate cost (Σ time_to_understanding_sec × org.js hourly_rate_eur, EUR + blocked-with-deadline-cost ' +
      'count), delegation depth (model-owned decision_types + delegations signed in the window), and aggregate-only ' +
      'candor-delivered / kill-switch-activation counts. Writes .mt/reports/YYYY-MM-DD-delta.md.',
    input: {
      mandatesDir: MANDATES_DIR,
      periodDays: { type: 'number', required: false, description: 'Window size in days — defaults to 7.' }
    },
    tauri: 'delta_report', // фаза B: пряма Rust-команда (delta-core::report), той самий crate, що CLI
    cli: true
  },
  {
    tier: 'write',
    name: 'kill_switch_on',
    summary:
      'M6 panic button — NO quiz, NO confirmation, instant (docs/specs/260809-delta-app.md, «Обсяг M6», п.3). ' +
      'Writes a signed .mt/kill-switch/{handle}.json marker — a SUSPENSION layer, mandates.yaml is never mutated ' +
      '(reversible by construction). While active, decisions_show/watcher_scan redirect every fork delegated to (or ' +
      "newly routed to) this handle's own AI mandates back to this handle, and the watcher stops pinging/escalating " +
      'on them.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'kill_switch_on',
    cli: true
  },
  {
    tier: 'write',
    name: 'kill_switch_off',
    summary:
      'M6 — deactivates the kill-switch (empties the marker) with a NEW signature, logged for the delta-report activation count.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'kill_switch_off',
    cli: true
  },
  {
    tier: 'read',
    name: 'kill_switch_status',
    summary: 'M6 — read the CURRENT kill-switch state ({active: boolean}) of one handle.',
    input: { mandatesDir: MANDATES_DIR, handle: HANDLE },
    tauri: 'kill_switch_status',
    cli: true
  },
  {
    tier: 'write',
    name: 'review_agenda',
    summary:
      'M6 weekly delta-review agenda: deterministic (no LLM) — (a) draft-widen candidates (models with N+ override-free ' +
      'decisions in the window whose delegator has no active kill-switch) get an ai_petition-pattern change-proposal ' +
      'MATERIALIZED automatically, ready for the delegator to sign via the normal decision_quiz/decision_approve flow; ' +
      '(b) narrow candidates (override-ers or active kill-switch, informational only); (c) open quorum divergences and ' +
      'stale open decisions across the whole workspace. Writes .mt/reviews/YYYY-MM-DD-agenda.md.',
    input: {
      mandatesDir: MANDATES_DIR,
      periodDays: { type: 'number', required: false, description: 'Window size in days — defaults to 7.' }
    },
    tauri: 'review_agenda', // фаза B: пряма Rust-команда (delta-core::review), той самий crate, що CLI
    cli: true
  }
]
