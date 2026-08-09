import { describe, expect, it } from 'vitest'
import {
  applyMandateChangeIfValid,
  buildMandateChangePayload,
  classifyMandateChange,
  formatMandatesFile,
  parseMandatesFile,
  signMandateChangeAct,
  validateMandateChange,
  validateMandatesFileStructure
} from '../mandate-change.js'
import { generateDeviceKeypair } from '../signing.js'

const GENERATION_RE = /generation/
const SELF_SIGN_RE = /самопідпис/
const ANOTHER_ROOT_RE = /кореневий/
const DANGLING_HANDLE_RE = /висячий/
const SCOPE_REFS_RE = /scope\.refs/
const SCOPE_DECISION_TYPES_RE = /scope\.decision_types/
const AUDACITY_RE = /audacity/
const DUPLICATE_OWNER_RE = /більше одного разу/
const DELEGATOR_RE = /делегатора/
const HUMAN_ONLY_RE = /людський/
const DOUBLE_SIGNATURE_RE = /ПОДВІЙНОГО/
const STRUCTURAL_RE = /невалідний/
const ROOT_RE = /кореневого/

/**
 * @param {number} generation `generation` файлу
 * @returns {{generation: number, mandates: object[]}} базова фікстура — та сама, що change.rs::tests::base_file
 */
function baseFile(generation) {
  return {
    generation,
    mandates: [
      {
        owner: 'olena',
        kind: 'person',
        scope: { refs: ['refs/mt/tasks/design/**'], decisionTypes: ['architecture'] },
        thresholds: { budgetEur: 2000, risk: 'medium', irreversible: false, audacity: null },
        escalatesTo: 'vitalii'
      },
      {
        owner: 'vitalii',
        kind: 'person',
        scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] },
        thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null },
        escalatesTo: null
      }
    ]
  }
}

/**
 * @param {object} mandate шаблон для клонування
 * @param {object} [overrides] поля для заміни
 * @returns {object} клон мандата з переозначеними полями (глибокий clone thresholds/scope)
 */
function cloneMandate(mandate, overrides = {}) {
  return {
    ...mandate,
    scope: { ...mandate.scope },
    thresholds: { ...mandate.thresholds },
    ...overrides
  }
}

/**
 * @param {{generation: number, mandates: object[]}} file файл, над яким підписуємо
 * @param {number} oldGeneration `generation` old-файлу
 * @param {{handle: string, role: 'human'|'model'}} signer заявлений підписант
 * @returns {Promise<object>} готовий підпис (MandateChangeSignature) з реальним keypair
 */
async function signAs(file, oldGeneration, { handle, role }) {
  const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
  return signMandateChangeAct({ oldGeneration, newFile: file, handle, role, privateKeyJwk, publicKeyBase64 })
}

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{store: Map<string,string>, writeFile: (path:string, content:string) => Promise<void>}} in-memory io
 */
function memoryIo(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    writeFile: (path, content) => {
      store.set(path, content)
    }
  }
}

describe('validateMandatesFileStructure — мок parse.rs::validate', () => {
  it('валідна фікстура (3 мандати, 1 корінь) — valid', () => {
    const fixture = {
      generation: 3,
      mandates: [
        ...baseFile(3).mandates,
        {
          owner: 'fable-5',
          kind: 'model',
          scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] },
          thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'medium' },
          escalatesTo: 'olena'
        }
      ]
    }
    expect(validateMandatesFileStructure(fixture)).toEqual({ valid: true })
  })

  it('generation < 1 — невалідно', () => {
    const result = validateMandatesFileStructure({ generation: 0, mandates: baseFile(1).mandates })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(GENERATION_RE)
  })

  it('порожній mandates[] — невалідно', () => {
    const result = validateMandatesFileStructure({ generation: 1, mandates: [] })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(ROOT_RE)
  })

  it('нуль коренів (escalates_to: null ніде) — невалідно', () => {
    const file = baseFile(1)
    file.mandates[1] = cloneMandate(file.mandates[1], { escalatesTo: 'ghost' })
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(ROOT_RE)
  })

  it('два корені — невалідно', () => {
    const file = baseFile(1)
    file.mandates[0] = cloneMandate(file.mandates[0], { escalatesTo: null })
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(ANOTHER_ROOT_RE)
  })

  it('цикл ескалації без кореня — невалідно', () => {
    const file = {
      generation: 1,
      mandates: [
        { owner: 'a', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: 'b' },
        { owner: 'b', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: 'a' }
      ]
    }
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(ROOT_RE)
  })

  it('висячий escalates_to handle — невалідно (є корінь, але інший owner ескалює у ніщо)', () => {
    const file = {
      generation: 1,
      mandates: [
        { owner: 'root', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: null },
        { owner: 'a', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: 'ghost' }
      ]
    }
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(DANGLING_HANDLE_RE)
  })

  it('порожній scope.refs — невалідно', () => {
    const file = baseFile(1)
    file.mandates[0] = cloneMandate(file.mandates[0], { scope: { refs: [], decisionTypes: ['architecture'] } })
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(SCOPE_REFS_RE)
  })

  it('порожній scope.decisionTypes — невалідно', () => {
    const file = baseFile(1)
    file.mandates[0] = cloneMandate(file.mandates[0], { scope: { refs: ['refs/mt/**'], decisionTypes: [] } })
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(SCOPE_DECISION_TYPES_RE)
  })

  it('audacity на kind: person — невалідно', () => {
    const file = baseFile(1)
    file.mandates[0] = cloneMandate(file.mandates[0], { thresholds: { ...file.mandates[0].thresholds, audacity: 'low' } })
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(AUDACITY_RE)
  })

  it('дублікат owner — невалідно', () => {
    const file = {
      generation: 1,
      mandates: [
        { owner: 'a', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: null },
        { owner: 'a', kind: 'person', scope: { refs: ['refs/mt/other/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: null }
      ]
    }
    const result = validateMandatesFileStructure(file)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(DUPLICATE_OWNER_RE)
  })
})

describe('classifyMandateChange', () => {
  const [olena] = baseFile(1).mandates

  it('новий owner — added', () => {
    expect(classifyMandateChange(null, olena)).toBe('added')
  })

  it('зниклий owner — removed (звуження «до нуля»)', () => {
    expect(classifyMandateChange(olena, null)).toBe('removed')
  })

  it('обидва відсутні — unchanged', () => {
    expect(classifyMandateChange(null, null)).toBe('unchanged')
  })

  it('kind змінився (person→model) — kind-changed', () => {
    expect(classifyMandateChange(olena, cloneMandate(olena, { kind: 'model' }))).toBe('kind-changed')
  })

  it('escalates_to змінився — escalates-to-changed', () => {
    expect(classifyMandateChange(olena, cloneMandate(olena, { escalatesTo: 'someone-else' }))).toBe('escalates-to-changed')
  })

  it('вищий budgetEur — widened', () => {
    expect(classifyMandateChange(olena, cloneMandate(olena, { thresholds: { ...olena.thresholds, budgetEur: 3000 } }))).toBe('widened')
  })

  it('нижчий budgetEur — narrowed', () => {
    expect(classifyMandateChange(olena, cloneMandate(olena, { thresholds: { ...olena.thresholds, budgetEur: 1000 } }))).toBe('narrowed')
  })

  it('змішаний diff (budget вгору, risk вниз) — widened (не можна протягнути розширення під виглядом самопідписаного звуження)', () => {
    const mixed = cloneMandate(olena, { thresholds: { ...olena.thresholds, budgetEur: 3000, risk: 'low' } })
    expect(classifyMandateChange(olena, mixed)).toBe('widened')
  })

  it('нічого не змінилось — unchanged', () => {
    expect(classifyMandateChange(olena, cloneMandate(olena))).toBe('unchanged')
  })

  it('audacity вгору на kind: model — widened; на kind: person вісь ігнорується', () => {
    const model = cloneMandate(olena, { kind: 'model', thresholds: { ...olena.thresholds, audacity: 'low' } })
    expect(classifyMandateChange(model, cloneMandate(model, { thresholds: { ...model.thresholds, audacity: 'high' } }))).toBe('widened')
  })

  it('decision_types "*" — розширити нікуди (уже покриває все)', () => {
    const wildcard = cloneMandate(olena, { scope: { refs: olena.scope.refs, decisionTypes: ['*'] } })
    const narrowed = cloneMandate(wildcard, { scope: { refs: wildcard.scope.refs, decisionTypes: ['architecture'] } })
    expect(classifyMandateChange(wildcard, narrowed)).toBe('narrowed')
  })
})

describe('validateMandateChange — мок change.rs::validate_mandate_change (звір з тест-кейсами crate)', () => {
  it('generation має зрости РІВНО на 1 — стрибок на 2 невалідний', async () => {
    const old = baseFile(3)
    const newFile = { ...baseFile(3), generation: 5 }
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [] })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(GENERATION_RE)
  })

  it('звуження без самопідпису — невалідно', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 1000 } })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [] })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(SELF_SIGN_RE)
  })

  it('звуження із самопідписом owner — валідно', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 1000 } })
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict).toEqual({ valid: true })
  })

  it('розширення без підпису делегатора — невалідно (підписав сам owner, не делегатор)', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 3000 } })
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(DELEGATOR_RE)
  })

  it('розширення з підписом делегатора (vitalii — делегатор olena) — валідно', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 3000 } })
    const sig = await signAs(newFile, 1, { handle: 'vitalii', role: 'human' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict).toEqual({ valid: true })
  })

  it('«остання константа»: розширення ШІ-мандата з модельним підписом делегатора — невалідно навіть якщо делегатор саме той', async () => {
    const old = baseFile(1)
    old.mandates.push({
      owner: 'fable-5',
      kind: 'model',
      scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] },
      thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'low' },
      escalatesTo: 'olena'
    })
    const newFile = structuredClone(old)
    newFile.generation = 2
    newFile.mandates[2].thresholds.audacity = 'high'
    // "olena" — делегатор fable-5, але підписує МОДЕЛЬНИМ ключем.
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'model' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(HUMAN_ONLY_RE)
  })

  it('розширення ШІ-мандата з ЛЮДСЬКИМ підписом делегатора — валідно', async () => {
    const old = baseFile(1)
    old.mandates.push({
      owner: 'fable-5',
      kind: 'model',
      scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] },
      thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'low' },
      escalatesTo: 'olena'
    })
    const newFile = structuredClone(old)
    newFile.generation = 2
    newFile.mandates[2].thresholds.audacity = 'high'
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict).toEqual({ valid: true })
  })

  it('зміна escalates_to вимагає ПОДВІЙНОГО підпису — лише новий адресат недостатньо', async () => {
    const old = baseFile(1)
    old.mandates.push({
      owner: 'petro',
      kind: 'person',
      scope: { refs: ['refs/mt/tasks/ops/**'], decisionTypes: ['ops'] },
      thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null },
      escalatesTo: 'olena'
    })
    const newFile = structuredClone(old)
    newFile.generation = 2
    newFile.mandates[2].escalatesTo = 'vitalii' // petro тепер під vitalii

    const sigNewAddressee = await signAs(newFile, 1, { handle: 'vitalii', role: 'human' })
    const onlyOne = await validateMandateChange({ old, new: newFile, signatures: [sigNewAddressee] })
    expect(onlyOne.valid).toBe(false)
    expect(onlyOne.reason).toMatch(DOUBLE_SIGNATURE_RE)

    const sigOldDelegator = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const both = await validateMandateChange({ old, new: newFile, signatures: [sigNewAddressee, sigOldDelegator] })
    expect(both).toEqual({ valid: true })
  })

  it('невалідні байти підпису не рахуються (fail-closed)', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 1000 } })
    const { publicKeyBase64 } = await generateDeviceKeypair()
    const verdict = await validateMandateChange({
      old,
      new: newFile,
      signatures: [{ handle: 'olena', role: 'human', pubkeyBase64: publicKeyBase64, signature: 'AA==' }]
    })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(SELF_SIGN_RE)
  })

  it('новий стан, що ламає структурну валідацію (немає кореня) — невалідно, підписи не рятують', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[1] = cloneMandate(newFile.mandates[1], { escalatesTo: 'olena' }) // ламає корінь
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const verdict = await validateMandateChange({ old, new: newFile, signatures: [sig] })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(STRUCTURAL_RE)
  })

  it('mixed diff одного owner — widened трактується як розширення, потребує делегатора', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], {
      thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 3000, risk: 'low' }
    })
    const selfSig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const selfOnly = await validateMandateChange({ old, new: newFile, signatures: [selfSig] })
    expect(selfOnly.valid).toBe(false) // самопідпис недостатній — це розширення, не звуження
    const delegatorSig = await signAs(newFile, 1, { handle: 'vitalii', role: 'human' })
    const withDelegator = await validateMandateChange({ old, new: newFile, signatures: [delegatorSig] })
    expect(withDelegator).toEqual({ valid: true })
  })
})

describe('parseMandatesFile / formatMandatesFile — round-trip', () => {
  it('відсутнє generation — дефолт 1 (той самий дефолт, що фікстури M0-M2)', () => {
    const file = parseMandatesFile('mandates:\n  - owner: a\n    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }\n    thresholds: {}\n    escalates_to: null\n')
    expect(file.generation).toBe(1)
  })

  it('явне generation розбирається', () => {
    const file = parseMandatesFile('generation: 7\nmandates:\n  - owner: a\n    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }\n    thresholds: {}\n    escalates_to: null\n')
    expect(file.generation).toBe(7)
  })

  it('порожній/відсутній текст — {generation: 1, mandates: []}', () => {
    expect(parseMandatesFile('')).toEqual({ generation: 1, mandates: [] })
    expect(parseMandatesFile(null)).toEqual({ generation: 1, mandates: [] })
  })

  it('formatMandatesFile → parseMandatesFile — round-trip зберігає generation і мандати', () => {
    const original = baseFile(4)
    const text = formatMandatesFile(original)
    const parsed = parseMandatesFile(text)
    expect(parsed).toEqual(original)
  })
})

describe('buildMandateChangePayload', () => {
  it('фіксує oldGeneration/newGeneration/новий файл — зміна будь-якого поля міняє payload', () => {
    const newFile = baseFile(2)
    const payload = buildMandateChangePayload(1, newFile)
    expect(payload.old_generation).toBe(1)
    expect(payload.new_generation).toBe(2)
    expect(payload.new_file).toEqual(newFile)
  })
})

describe('applyMandateChangeIfValid', () => {
  it('Valid-вердикт — пише mandates.yaml', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 1000 } })
    const sig = await signAs(newFile, 1, { handle: 'olena', role: 'human' })
    const io = memoryIo()
    const verdict = await applyMandateChangeIfValid({ io, mandatesYamlPath: '/root/.mt/mandates.yaml', old, new: newFile, signatures: [sig] })
    expect(verdict).toEqual({ valid: true })
    expect(io.store.has('/root/.mt/mandates.yaml')).toBe(true)
    expect(parseMandatesFile(io.store.get('/root/.mt/mandates.yaml'))).toEqual(newFile)
  })

  it('Invalid-вердикт — файл НЕ пишеться', async () => {
    const old = baseFile(1)
    const newFile = baseFile(2)
    newFile.mandates[0] = cloneMandate(newFile.mandates[0], { thresholds: { ...newFile.mandates[0].thresholds, budgetEur: 1000 } })
    const io = memoryIo()
    const verdict = await applyMandateChangeIfValid({ io, mandatesYamlPath: '/root/.mt/mandates.yaml', old, new: newFile, signatures: [] })
    expect(verdict.valid).toBe(false)
    expect(io.store.has('/root/.mt/mandates.yaml')).toBe(false)
  })
})
