/**
 * Maandtelling voor Overzicht — zelfde logica als Deals & offertes (kolom-subtotalen).
 */

import { DEALS_OFFERTES_STAGES, getDealPipelineStage, type DealRow } from './api'
import { toMonthKey } from './pipelineSession'
import type { PipelineTargetStage } from './pipelineTargets'

export type OverviewMonthMap = Record<PipelineTargetStage, number>

const STAGE_TO_OVERVIEW: Record<string, PipelineTargetStage> = {
  discovery_voorgesteld: 'Discovery call voorgesteld',
  discovery_gepland: 'Discovery call ingepland',
  discovery_plaatsgevonden: 'Discovery call plaatsgevonden',
  offerte_verzonden: 'Offerte verzonden',
  offerte_aanvaard: 'Offerte geaccepteerd',
}

const PHASE_TO_STAGE: Record<string, string> = {
  'cfcab239-a580-0baa-886c-ab6c07139f56': 'leads_appointment_setting_selah',
  '024c5cb0-8dbd-0936-946b-8234a21119c7': 'lead_gekwalificeerd',
  '43dbb965-8ce4-0e68-ad61-386a1e1119c8': 'discovery_voorgesteld',
  '0385e81d-8526-0ebe-926f-f33c611119c9': 'discovery_gepland',
  '1e7c4d04-ba14-0f20-866f-3823fe136cb6': 'discovery_plaatsgevonden',
  '393c9be5-8374-0ceb-bf63-6038a31119ca': 'offerte_verzonden',
  '8d3c023d-216a-0057-a362-75e6d81119cc': 'offerte_geweigerd',
}

function emptyOverviewMonth(): OverviewMonthMap {
  return {
    'Discovery call voorgesteld': 0,
    'Discovery call ingepland': 0,
    'Discovery call plaatsgevonden': 0,
    'Offerte verzonden': 0,
    'Offerte geaccepteerd': 0,
  }
}

function phaseEntryToStage(phaseIdRaw: string, phaseNameRaw: string): string | null {
  const phaseId = phaseIdRaw.toLowerCase()
  const phaseName = phaseNameRaw.toLowerCase()
  if (phaseId) {
    const byExact = PHASE_TO_STAGE[phaseId]
    if (byExact) return byExact
    if (phaseId.startsWith('f084a9bc')) return 'offerte_aanvaard'
  }
  if (phaseName.includes('lead gekwalificeerd')) return 'lead_gekwalificeerd'
  if (
    phaseName.includes('appointment setting selah') ||
    phaseName.includes('leads appointment setting selah')
  ) {
    return 'leads_appointment_setting_selah'
  }
  if (phaseName.includes('discovery call voorgesteld')) return 'discovery_voorgesteld'
  if (phaseName.includes('discovery call gepland')) return 'discovery_gepland'
  if (phaseName.includes('discovery call plaatsgevonden')) return 'discovery_plaatsgevonden'
  if (phaseName.includes('offerte verzonden')) return 'offerte_verzonden'
  if (phaseName.includes('offerte aanvaard') || phaseName.includes('offerte geaccepteerd'))
    return 'offerte_aanvaard'
  if (phaseName.includes('offerte geweigerd') || phaseName.includes('offerte afgewezen'))
    return 'offerte_geweigerd'
  return null
}

const OUTCOME_STAGES = new Set(['offerte_aanvaard', 'offerte_geweigerd'])

function explicitStageMonthsByDeal(deal: DealRow): Map<string, string> {
  const anyDeal = deal as Record<string, unknown>
  const hist = anyDeal.phase_history as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(hist)) return new Map<string, string>()
  const explicitMonthsByStage = new Map<string, string>()
  for (const entry of hist) {
    const phase = (entry.phase as Record<string, unknown> | undefined) ?? undefined
    const phaseId = String(phase?.id ?? '').toLowerCase()
    const phaseName = String(phase?.name ?? '')
    const startedAt = String(entry.started_at ?? '')
    const stage = phaseEntryToStage(phaseId, phaseName)
    if (!stage) continue
    const m = toMonthKey(startedAt)
    if (!m) continue
    if (!explicitMonthsByStage.has(stage)) explicitMonthsByStage.set(stage, m)
  }
  return explicitMonthsByStage
}

function inferStageMonthsByDeal(deal: DealRow): Map<string, string> {
  const anyDeal = deal as Record<string, unknown>
  const hist = anyDeal.phase_history as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(hist)) return new Map<string, string>()
  const explicitMonthsByStage = new Map<string, string>()
  for (const entry of hist) {
    const phase = (entry.phase as Record<string, unknown> | undefined) ?? undefined
    const phaseId = String(phase?.id ?? '').toLowerCase()
    const phaseName = String(phase?.name ?? '')
    const startedAt = String(entry.started_at ?? '')
    const stage = phaseEntryToStage(phaseId, phaseName)
    if (!stage) continue
    const m = toMonthKey(startedAt)
    if (!m) continue
    if (!explicitMonthsByStage.has(stage)) explicitMonthsByStage.set(stage, m)
  }

  const current = getDealPipelineStage(deal)
  const baseOrder = [
    'leads_appointment_setting_selah',
    'discovery_voorgesteld',
    'discovery_gepland',
    'discovery_plaatsgevonden',
    'offerte_verzonden',
  ]
  const stageOrder =
    current === 'offerte_geweigerd'
      ? [...baseOrder, 'offerte_geweigerd']
      : [...baseOrder, 'offerte_aanvaard']

  const hasLaterExplicit = (idx: number): boolean => {
    for (let i = idx + 1; i < stageOrder.length; i++) {
      if (explicitMonthsByStage.get(stageOrder[i]!)) return true
    }
    return false
  }
  let inheritedMonth = ''
  const inferredMonthsByStage = new Map<string, string>()
  for (let i = 0; i < stageOrder.length; i++) {
    const st = stageOrder[i]!
    const explicit = explicitMonthsByStage.get(st) ?? ''
    if (explicit) {
      inheritedMonth = explicit
      inferredMonthsByStage.set(st, explicit)
      continue
    }
    if (inheritedMonth && hasLaterExplicit(i)) {
      inferredMonthsByStage.set(st, inheritedMonth)
    }
  }
  return inferredMonthsByStage
}

function stagesReachedInMonth(deal: DealRow, monthKey: string): Set<string> {
  const inferred = inferStageMonthsByDeal(deal)
  const explicit = explicitStageMonthsByDeal(deal)
  const out = new Set<string>()
  for (const [st, inferredMonth] of inferred.entries()) {
    if (inferredMonth !== monthKey) continue
    if (OUTCOME_STAGES.has(st)) {
      if (explicit.get(st) === monthKey) out.add(st)
    } else {
      out.add(st)
    }
  }
  return out
}

function normalizeKindValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const s = o.value ?? o.label ?? o.name ?? o.id
    return String(s).trim().toLowerCase()
  }
  return String(v).trim().toLowerCase()
}

function customerKindOf(deal: DealRow): { value: string; source: string } | null {
  const anyDeal = deal as Record<string, unknown>
  const directKeys = [
    'is_new_customer', 'isNewCustomer', 'new_customer', 'newCustomer',
    'is_existing_customer', 'isExistingCustomer', 'existing_customer', 'existingCustomer',
    'customer_type', 'customerType', 'klant_type', 'type_klant',
  ]
  for (const k of directKeys) {
    if (!(k in anyDeal)) continue
    const val = normalizeKindValue(anyDeal[k])
    if (val) return { value: val, source: k }
  }
  const customArrays = ['custom_fields', 'customFieldValues', 'custom_field_values']
  for (const arrKey of customArrays) {
    const arr = anyDeal[arrKey]
    if (!Array.isArray(arr)) continue
    for (const item of arr as Array<Record<string, unknown>>) {
      const name = String(
        item.name ??
        ((item.definition as Record<string, unknown> | undefined)?.name ?? ''),
      ).trim().toLowerCase()
      if (!name) continue
      if (!/nieuw|new|existing|bestaand|oud|old|klant_type|customer/.test(name)) continue
      const raw = item.value ?? item.selected ?? item.option ?? item.data
      const val = normalizeKindValue(raw)
      if (val) return { value: val, source: `${arrKey}:${name}` }
    }
  }
  return null
}

function isOldCustomer(deal: DealRow): boolean {
  const k = customerKindOf(deal)
  if (!k) return false
  const v = k.value
  const src = k.source.toLowerCase()
  const oldValues = new Set(['oud', 'old', 'bestaand', 'existing customer', 'bestaande klant'])
  if (oldValues.has(v)) return true
  if ((src.includes('is_new') || src.includes('new_customer')) && v === 'false') return true
  if (src.includes('existing') && v === 'true') return true
  return false
}

function dealTouchesMonth(deal: DealRow, monthKey: string): boolean {
  const anyDeal = deal as Record<string, unknown>
  for (const k of ['updated_at', 'closed_at', 'created_at']) {
    if (toMonthKey(String(anyDeal[k] ?? '')) === monthKey) return true
  }
  return false
}

export { stagesReachedInMonth }

/** Zelfde kolom-plaatsing als Deals & offertes voor één maand. */
export function buildDealsByStageForMonth(
  deals: DealRow[],
  monthKey: string,
): Record<string, DealRow[]> {
  const byStageActual: Record<string, DealRow[]> = {}
  for (const { id } of DEALS_OFFERTES_STAGES) {
    byStageActual[id] = []
  }

  for (const d of deals) {
    const reached = stagesReachedInMonth(d, monthKey)
    const reachedList = [...reached]
    let fallbackAsFirstVisible = false

    if (reachedList.length === 0) {
      const hasHistory =
        Array.isArray((d as Record<string, unknown>).phase_history) &&
        ((d as Record<string, unknown>).phase_history as unknown[]).length > 0
      const createdMonth = toMonthKey(String(d.created_at ?? ''))
      const fallbackStage = getDealPipelineStage(d)

      if (
        !hasHistory &&
        fallbackStage &&
        !OUTCOME_STAGES.has(fallbackStage) &&
        byStageActual[fallbackStage] &&
        dealTouchesMonth(d, monthKey)
      ) {
        if (isOldCustomer(d)) continue
        byStageActual[fallbackStage].push(d)
        continue
      }

      if (!hasHistory && createdMonth === monthKey && fallbackStage === 'lead_gekwalificeerd') {
        fallbackAsFirstVisible = true
      } else {
        continue
      }
    }

    if (isOldCustomer(d)) continue

    if (fallbackAsFirstVisible) {
      byStageActual.discovery_voorgesteld.push(d)
    } else {
      for (const st of reached) {
        if (byStageActual[st]) byStageActual[st].push(d)
      }
    }
  }

  return byStageActual
}

/** Overzicht-kolommen = subtotalen per Deals-kolom (niet cumulatief op huidige fase). */
export function overviewMonthMapFromDeals(deals: DealRow[], monthKey: string): OverviewMonthMap {
  const byStage = buildDealsByStageForMonth(deals, monthKey)
  const out = emptyOverviewMonth()
  for (const [stageId, overviewKey] of Object.entries(STAGE_TO_OVERVIEW)) {
    out[overviewKey] = byStage[stageId]?.length ?? 0
  }
  return out
}
