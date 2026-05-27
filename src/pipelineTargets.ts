/**
 * Doelstellingen per jaar (localStorage), gedeeld tussen Overzicht en Deals & offertes.
 */

export const PIPELINE_TARGET_STAGES = [
  'Discovery call voorgesteld',
  'Discovery call ingepland',
  'Discovery call plaatsgevonden',
  'Offerte verzonden',
  'Offerte geaccepteerd',
] as const

export type PipelineTargetStage = (typeof PIPELINE_TARGET_STAGES)[number]
export type PipelineTargets = Record<PipelineTargetStage, number>
export type PipelineTargetsByYear = Record<string, PipelineTargets>

const STORAGE_BY_YEAR = 'rro_pipeline_targets_by_year'
const STORAGE_LEGACY = 'rro_manual_pipeline_targets'

const DEFAULT_BY_YEAR: Record<number, PipelineTargets> = {
  2024: {
    'Discovery call voorgesteld': 6,
    'Discovery call ingepland': 4,
    'Discovery call plaatsgevonden': 4,
    'Offerte verzonden': 4,
    'Offerte geaccepteerd': 1,
  },
  2025: {
    'Discovery call voorgesteld': 6,
    'Discovery call ingepland': 4,
    'Discovery call plaatsgevonden': 4,
    'Offerte verzonden': 4,
    'Offerte geaccepteerd': 1,
  },
  2026: {
    'Discovery call voorgesteld': 18,
    'Discovery call ingepland': 12,
    'Discovery call plaatsgevonden': 10,
    'Offerte verzonden': 9,
    'Offerte geaccepteerd': 3,
  },
}

export function defaultTargetsForYear(year: number): PipelineTargets {
  return { ...(DEFAULT_BY_YEAR[year] ?? DEFAULT_BY_YEAR[2025]) }
}

function normalizeTargets(raw: Partial<PipelineTargets> | null | undefined): PipelineTargets {
  const base = defaultTargetsForYear(2025)
  if (!raw) return base
  return {
    'Discovery call voorgesteld': Number(raw['Discovery call voorgesteld'] ?? base['Discovery call voorgesteld']),
    'Discovery call ingepland': Number(raw['Discovery call ingepland'] ?? base['Discovery call ingepland']),
    'Discovery call plaatsgevonden': Number(raw['Discovery call plaatsgevonden'] ?? base['Discovery call plaatsgevonden']),
    'Offerte verzonden': Number(raw['Offerte verzonden'] ?? base['Offerte verzonden']),
    'Offerte geaccepteerd': Number(raw['Offerte geaccepteerd'] ?? base['Offerte geaccepteerd']),
  }
}

function parseLegacyFlat(raw: string): PipelineTargets | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed['Discovery call voorgesteld'] == null) return null
    return normalizeTargets(parsed as Partial<PipelineTargets>)
  } catch {
    return null
  }
}

function loadAllByYear(): PipelineTargetsByYear {
  try {
    const raw = localStorage.getItem(STORAGE_BY_YEAR)
    if (raw) {
      const parsed = JSON.parse(raw) as PipelineTargetsByYear
      const out: PipelineTargetsByYear = {}
      for (const y of [2024, 2025, 2026]) {
        const key = String(y)
        out[key] = normalizeTargets(parsed[key] ?? defaultTargetsForYear(y))
      }
      return out
    }
  } catch {
    /* fall through to migration */
  }

  const legacy = localStorage.getItem(STORAGE_LEGACY)
  const legacyTargets = legacy ? parseLegacyFlat(legacy) : null
  const migrated: PipelineTargetsByYear = {}
  for (const y of [2024, 2025, 2026]) {
    migrated[String(y)] = legacyTargets ? { ...legacyTargets } : defaultTargetsForYear(y)
  }
  localStorage.setItem(STORAGE_BY_YEAR, JSON.stringify(migrated))
  return migrated
}

function saveAllByYear(all: PipelineTargetsByYear): void {
  localStorage.setItem(STORAGE_BY_YEAR, JSON.stringify(all))
}

export function loadTargetsForYear(year: number): PipelineTargets {
  const all = loadAllByYear()
  return all[String(year)] ?? defaultTargetsForYear(year)
}

export function saveTargetsForYear(year: number, targets: PipelineTargets): void {
  const all = loadAllByYear()
  all[String(year)] = normalizeTargets(targets)
  saveAllByYear(all)
}

/** Deals-kolommen: stage-id → maandoelstelling voor geselecteerd jaar. */
export function stageTargetsByIdForYear(year: number): Record<string, number> {
  const t = loadTargetsForYear(year)
  return {
    lead_gekwalificeerd: 0,
    leads_appointment_setting_selah: 0,
    discovery_voorgesteld: t['Discovery call voorgesteld'],
    discovery_gepland: t['Discovery call ingepland'],
    discovery_plaatsgevonden: t['Discovery call plaatsgevonden'],
    offerte_verzonden: t['Offerte verzonden'],
    offerte_aanvaard: t['Offerte geaccepteerd'],
    offerte_geweigerd: 0,
  }
}

export function pctTarget(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}
