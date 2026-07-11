// Плановик (M1, docs/specs/260711-owner-app.md): LLM генерує 2 альтернативні
// декомпозиції цілі різними лінзами; власник обирає і редагує, підпис —
// штатним plan-review гейтом. Тут — чиста частина: промпти лінз, парсинг
// відповіді моделі, серіалізація children у YAML plan-файлу.

// Кожна лінза — окремий незалежний виклик моделі: різні кути дають
// різноманітність, якої не дає одна відповідь «дай два варіанти».
export const LENSES = [
  {
    key: 'lean',
    title: 'Мінімальний шлях',
    angle:
      'Найкоротший шлях до працюючого результату: якнайменше підзадач, без запасних перевірок; агентам — усе, що вони можуть зробити самостійно.'
  },
  {
    key: 'thorough',
    title: 'Повнота і ризики',
    angle:
      'Повне покриття цілі: явні перевірки якості, ризикові місця як окремі підзадачі, людям — рішення й приймання, агентам — механічну роботу.'
  }
]

const REPLY_SHAPE = `{
  "context": "стисле переформулювання цілі і підходу (2-3 речення)",
  "risks": "головні ризики плану, по одному на рядок через «- »",
  "children": [
    {
      "id": "kebab-case-латиницею",
      "mode": "agent або human",
      "model_tier": "MINI|AVG|MAX (лише для agent, опційно)",
      "qualification": "хто потрібен (лише для human, опційно)",
      "budget_sec": 1800,
      "deps": ["id сусідньої підзадачі"],
      "task": "самодостатня місія підзадачі 1-3 реченнями"
    }
  ]
}`

/**
 * Промпт плановика для однієї лінзи.
 * @param {string} intent ціль власника природною мовою
 * @param {{ title: string, angle: string }} lens лінза декомпозиції
 * @returns {{ system: string, user: string }} пара повідомлень для chat
 */
export function plannerPrompt(intent, lens) {
  return {
    system: [
      'Ти — плановик декомпозиції задач для платформи mt, де виконавці — і люди, і ШІ-агенти з однаковим контрактом задачі.',
      `Твоя лінза: ${lens.title}. ${lens.angle}`,
      'Розбий ціль на 2–6 підзадач. Кожна підзадача самодостатня: виконавець бачить лише її текст.',
      'deps — лише id інших підзадач цього плану, без циклів. Мова текстів — мова цілі.',
      `Відповідай СУВОРО одним JSON-обʼєктом без markdown-обгортки, за схемою:\n${REPLY_SHAPE}`
    ].join('\n'),
    user: intent
  }
}

const NODE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Валідний node-id: непорожній kebab-case латиницею (сегмент без «/»).
 * @param {string} id кандидат
 * @returns {boolean} чи валідний
 */
export function validNodeId(id) {
  return NODE_ID_RE.test(id ?? '')
}

/**
 * Розбирає відповідь моделі в альтернативу плану; кидає з поясненням, якщо
 * форма невалідна (обгортки ```json``` толеруються).
 * @param {string} text сирий content відповіді моделі
 * @returns {{ context: string, risks: string, children: object[] }} альтернатива
 */
export function parseAlternative(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('відповідь плановика без JSON-обʼєкта')
  const parsed = JSON.parse(text.slice(start, end + 1))

  const children = Array.isArray(parsed.children) ? parsed.children : []
  if (children.length === 0) throw new Error('план без жодної підзадачі')

  const ids = new Set()
  for (const child of children) {
    validateChild(child, ids)
    ids.add(child.id)
  }
  return {
    context: typeof parsed.context === 'string' ? parsed.context : '',
    risks: typeof parsed.risks === 'string' ? parsed.risks : '',
    children
  }
}

/**
 * Валідує одну підзадачу проти вже оголошених id; нормалізує deps in-place.
 * @param {object} child підзадача з відповіді моделі
 * @param {Set<string>} ids id підзадач, оголошених раніше в плані
 */
function validateChild(child, ids) {
  if (!validNodeId(child.id)) throw new Error(`невалідний id підзадачі: ${JSON.stringify(child.id)}`)
  if (ids.has(child.id)) throw new Error(`дубль id підзадачі: ${child.id}`)
  if (child.mode !== 'agent' && child.mode !== 'human') {
    throw new Error(`підзадача ${child.id}: mode має бути agent|human`)
  }
  if (typeof child.task !== 'string' || child.task.trim() === '') {
    throw new Error(`підзадача ${child.id}: порожня місія`)
  }
  child.deps = (Array.isArray(child.deps) ? child.deps : []).filter(dep => typeof dep === 'string')
  for (const dep of child.deps) {
    // deps лише на РАНІШЕ оголошені підзадачі — дешева гарантія відсутності циклів.
    if (!ids.has(dep)) throw new Error(`підзадача ${child.id}: dep ${dep} не оголошений раніше в плані`)
  }
}

/**
 * Серіалізує підзадачі у YAML-блок `children:` формату plan_NNN.md
 * (той самий, що читає mt-core parse_children).
 * @param {object[]} children підзадачі альтернативи
 * @returns {string} YAML-текст із завершальним переносом рядка
 */
export function childrenToYaml(children) {
  const lines = ['children:']
  for (const child of children) {
    lines.push(`  - id: ${child.id}`, `    mode: ${child.mode}`)
    if (child.mode === 'agent' && child.model_tier) lines.push(`    model_tier: ${child.model_tier}`)
    if (child.mode === 'human' && child.qualification) lines.push(`    qualification: ${child.qualification}`)
    if (Number.isFinite(child.budget_sec)) lines.push(`    budget_sec: ${child.budget_sec}`)
    lines.push(`    deps: [${(child.deps ?? []).join(', ')}]`, '    task: |')
    for (const row of child.task.trim().split('\n')) lines.push(`      ${row}`)
  }
  return `${lines.join('\n')}\n`
}
