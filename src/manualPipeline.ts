/**
 * Vaste pipeline-data t/m mei 2026. Vanaf juni 2026: Teamleader API.
 *
 * Bronnen:
 * - 2024: alleen nov/dec (TOTAAL-sheet)
 * - 2025 jan: TOTAAL-sheet; feb–jun: Closing-sheet
 * - 2026 jan–mei: Discovery-sheet (jan-26 t/m mei-26)
 */

import type { DealRow } from './api'

export const MANUAL_PIPELINE_UNTIL = '2026-05'

export type ManualDealsStageId =
  | 'leads_appointment_setting_selah'
  | 'discovery_voorgesteld'
  | 'discovery_gepland'
  | 'discovery_plaatsgevonden'
  | 'offerte_verzonden'
  | 'offerte_aanvaard'
  | 'offerte_geweigerd'

export type ManualOverviewStage =
  | 'Discovery call voorgesteld'
  | 'Discovery call ingepland'
  | 'Discovery call plaatsgevonden'
  | 'Offerte verzonden'
  | 'Offerte geaccepteerd'

export type ManualOverviewMonth = Record<ManualOverviewStage, number>
export type ManualDealsMonth = Partial<Record<ManualDealsStageId, string[]>>

const OFFERTE_STAGES: ManualDealsStageId[] = [
  'offerte_verzonden',
  'offerte_aanvaard',
  'offerte_geweigerd',
]

const EMPTY_OVERVIEW: ManualOverviewMonth = {
  'Discovery call voorgesteld': 0,
  'Discovery call ingepland': 0,
  'Discovery call plaatsgevonden': 0,
  'Offerte verzonden': 0,
  'Offerte geaccepteerd': 0,
}

function overviewFromDeals(m: ManualDealsMonth): ManualOverviewMonth {
  return {
    'Discovery call voorgesteld': m.discovery_voorgesteld?.length ?? 0,
    'Discovery call ingepland': m.discovery_gepland?.length ?? 0,
    'Discovery call plaatsgevonden': m.discovery_plaatsgevonden?.length ?? 0,
    'Offerte verzonden': m.offerte_verzonden?.length ?? 0,
    'Offerte geaccepteerd': m.offerte_aanvaard?.length ?? 0,
  }
}

export function isManualPipelineMonth(monthKey: string): boolean {
  return /^\d{4}-\d{2}$/.test(monthKey) && monthKey <= MANUAL_PIPELINE_UNTIL
}

export function is2024Month(monthKey: string): boolean {
  return monthKey.startsWith('2024-')
}

/** Alleen maanden zonder handmatige offerte-lijsten (geen 2024 meer forceren op 0). */
export function offerteStagesEmptyForMonth(_monthKey: string): boolean {
  return false
}

export function manualDealRows(
  monthKey: string,
  stageId: ManualDealsStageId,
  names: string[],
): DealRow[] {
  return names.map((name, index) => ({
    id: `manual-${monthKey}-${stageId}-${index}`,
    title: name,
    company_name: name,
    __manual: true,
    __manualMonth: monthKey,
    __manualStage: stageId,
  }))
}

/** Deals & offertes: klantnamen per kolom en maand. */
export const manualDealsByMonth: Record<string, ManualDealsMonth> = {
  '2024-01': {},
  '2024-02': {},
  '2024-03': {},
  '2024-04': {},
  '2024-05': {},
  '2024-06': {},
  '2024-07': {},
  '2024-08': {},
  '2024-09': {},

  '2024-10': {},

  /** TOTAAL-sheet: november 2024 */
  '2024-11': {
    discovery_voorgesteld: [
      '4x6 Sofa', 'Kytsch', 'BER Bouw En Renovatie B.V.', 'WAAT', 'Van Tafel',
      'Insunnu', 'Operandi Interiors', 'Level2Store', 'Lupus Design', 'Red3 Design',
    ],
    discovery_gepland: ['4x6 Sofa', 'Kytsch', 'BER Bouw En Renovatie B.V.', 'WAAT', 'Van Tafel'],
    discovery_plaatsgevonden: ['4x6 Sofa', 'Kytsch', 'BER Bouw En Renovatie B.V.', 'Van Tafel'],
    offerte_verzonden: ['4x6 Sofa', 'Kytsch', 'BER Bouw En Renovatie B.V.', 'Van Tafel'],
  },
  /** TOTAAL-sheet: december 2024 */
  '2024-12': {
    discovery_voorgesteld: [
      'Rep Ringel Art', 'Brand&Young', 'RBMB NL', 'Rietpanel', 'Stepharts', 'Coenen concept',
      'Livium', 'Daudi concepts', 'SUNS', 'Van Spanje Kachels', 'Talenti Outdoor',
      'Ilm De Schilder', 'Yolanda Vogels', 'Jeroen Overmars', 'By Sven Design',
    ],
    discovery_gepland: [
      'Brand&Young', 'RBMB NL', 'Stepharts', 'Coenen concept', 'Talenti Outdoor',
      'Jeroen Overmars', 'Rep Ringel Art', 'Rietpanel', 'Livium', 'SUNS',
    ],
    discovery_plaatsgevonden: [
      'Brand&Young', 'RBMB NL', 'Stepharts', 'Coenen concept', 'Talenti Outdoor', 'Jeroen Overmars',
    ],
    offerte_verzonden: [
      'Brand&Young', 'RBMB NL', 'Stepharts', 'Talenti Outdoor', 'Jeroen Overmars',
    ],
  },

  /** TOTAAL-sheet: januari 2025 */
  '2025-01': {
    discovery_voorgesteld: [
      'Art by Coco', 'Cool-living', 'Lush Living Design', 'Casa Vita',
      'Son Schilderswerkum', 'Martin Cuypers BV', 'Vlea Design',
    ],
    discovery_gepland: ['Art by Coco', 'Cool-living', 'Yolanda Vogels'],
    discovery_plaatsgevonden: ['Art by Coco', 'SUNS', 'Yolanda Vogels', 'Rep Ringel Art'],
    offerte_verzonden: ['Stepharts', 'SUNS', 'Yolanda Vogels', 'Rep Ringel Art'],
    offerte_aanvaard: ['4x8 sofa', 'Yolanda Vogels'],
    offerte_geweigerd: ['Brand&Young', 'Stepharts', 'Solulu'],
  },

  /** Closing-sheet: februari–juni 2025 */
  '2025-02': {
    discovery_voorgesteld: [
      'Roosmarijn Knijnenburg', 'Pulo Wulu', 'Julianne Matter', 'Hotspring', 'Tenderflame', 'Cosy Me Interior',
    ],
    discovery_gepland: [
      'Lupus Design', 'Roosmarijn Knijnenburg', 'Pulo Wulu', 'Julianne Matter', 'Hotspring', 'Tenderflame', 'Cosy Me Interior',
    ],
    discovery_plaatsgevonden: ['Oakliving', 'Rietpaneel', 'Lupus Design', 'Roosmarijn Knijnenburg', 'Pulo Wulu'],
    offerte_verzonden: ['Pulo Wulu'],
    offerte_geweigerd: ['BFR Bouw'],
  },
  '2025-03': {
    discovery_voorgesteld: ['Four Q', 'MC Floor Styling', 'Eline - Academy'],
    discovery_gepland: [
      'Shin Schilderwerken', 'MC Floor Styling', 'Four Q', 'Eline - Academy', 'Business Art Service',
    ],
    discovery_plaatsgevonden: [
      'Cosy Me Interior', 'Eline - Academy', 'Jim de Schilder', 'Hotspring', 'Four Q', 'MC Floor Styling',
    ],
    offerte_verzonden: [
      'Art by Coco', 'Tenderflame', 'Julianne Matter', 'Eline - Academy', 'Cosy Me Interior', 'MC Floor Styling', 'Jim de Schilder',
    ],
    offerte_aanvaard: ['Eline - Academy'],
    offerte_geweigerd: ['Rep Rinyel', 'Pulo Wulu', 'Tenderflame'],
  },
  '2025-04': {
    discovery_voorgesteld: [
      'Webkarper.nl', 'Daniela Cupello', 'HOME Lifestyle', '123lampenkappen.nl', 'Slimmevilla.nl',
      'BMS Architecten', 'Orchidee NL', 'Spuiterij Frencken',
    ],
    discovery_gepland: ['Slimmevilla.nl', 'Orchidee NL'],
    discovery_plaatsgevonden: [],
    offerte_verzonden: [],
    offerte_aanvaard: ['Cosy Me Interior'],
  },
  '2025-05': {
    discovery_voorgesteld: [
      'Bespoke Design Studio', 'Ruimte Home', 'Domotica Design', 'HMVD Architecten',
      'De Opera Domotica', 'Eigenwijs', 'Lunova Keukens',
    ],
    discovery_gepland: [
      'Bespoke Design Studio', 'Ruimte Home', 'Domotica Design', 'By Sven Design',
      'De Opera Domotica', 'HMVD Architecten', 'Lunova Keukens',
    ],
    discovery_plaatsgevonden: [
      'Shin Schilderwerken', 'Bespoke Design Studio', 'Slimmevilla', 'Domotica Design',
      'By Sven Design', 'De Opera Domotica', 'Orchidee NL',
    ],
    offerte_verzonden: [
      'Bespoke Design Studio', 'Shin Schilderwerken', 'By Sven Design', 'Domotica Design', 'Orchidee NL',
    ],
    offerte_geweigerd: ['Bespoke Design Studio', 'By Sven Design'],
  },
  '2025-06': {
    discovery_voorgesteld: ['Decoretti'],
    discovery_gepland: ['Decoretti', 'BAAS Architecten'],
    discovery_plaatsgevonden: ['HMVD Architecten', 'Lunova Keukens', 'Decoretti'],
    offerte_verzonden: ['HMVD Architecten', 'Lunova Keukens', 'Rietpaneel', 'Slimme Villa'],
    offerte_aanvaard: ['MC Floor Styling', 'De Opera Domotica'],
    offerte_geweigerd: ['Orchidee'],
  },

  /** Nov/dec 2024-discovery → zelfde funnel in 2025 nov/dec */
  '2025-07': {
    discovery_voorgesteld: ['Chic Sense'],
    discovery_gepland: [],
    discovery_plaatsgevonden: ['Baas Architecten'],
    offerte_verzonden: ['BAAS Architecten', 'Decorette'],
    offerte_aanvaard: ['Slimme Villa'],
    offerte_geweigerd: ['Rietpaneel'],
  },
  '2025-08': {
    discovery_gepland: ['Coenen Concept'],
    offerte_aanvaard: ['Domotica Design'],
  },
  '2025-09': {
    discovery_voorgesteld: ['Best in Light', 'DG Vloertechniek'],
    discovery_gepland: ['Best in Light', 'DG Vloertechniek'],
    discovery_plaatsgevonden: ['Best in Light', 'Coenen Concept', 'DG Vloertechniek'],
    offerte_verzonden: ['Best in Light', 'Luna Concepts & Photography', 'DG Vloertechniek'],
    offerte_aanvaard: ['By Luna Concepts & Photography'],
    offerte_geweigerd: ['Baas Architecten', 'Lunova Keukens'],
  },
  '2025-10': {
    discovery_voorgesteld: ['Jurgen Smit'],
    discovery_gepland: ['Jurgen Smit'],
  },
  '2025-11': {
    discovery_voorgesteld: [
      'Cappaert en Gunther', 'Vinken Artworks', 'Plaagdier Preventie Nederland', 'Planzo',
      'Chicsense', 'Saskia van der Velden', 'Broos de Bruijn', 'Owen',
    ],
    discovery_gepland: ['Plaagdier Preventie Nederland', 'Cappaert en Gunther'],
    discovery_plaatsgevonden: ['Plaagdier Preventie Nederland'],
    offerte_verzonden: ['Plaagdier Preventie Nederland'],
  },
  '2025-12': {
    discovery_voorgesteld: [
      'Valentino', 'Verumbeem', 'Bureau Hamers', 'Marco Bakker Tuinen', 'Wim Beyaert', 'Humanin Hout',
    ],
    discovery_gepland: [
      'Vinken Artworks', 'Saskia van der Velden', 'Marco Bakker Tuinen', 'Valentino', 'Bureau Hamers',
    ],
    discovery_plaatsgevonden: [
      'Cappaert en Gunther', 'Vinken Artworks', 'Valentino', 'Saskia van der Velden',
    ],
    offerte_verzonden: ['Vinken Artworks', 'Cappaert en Gunther', 'Valentino'],
    offerte_aanvaard: ['DG Vloertechniek'],
    offerte_geweigerd: ['SUNS Outdoor'],
  },

  /** Discovery-sheet jan-26 t/m mei-26 */
  '2026-01': {
    discovery_voorgesteld: ['Horecalicht', 'Jasper Verhey', 'Relax Outdoor', 'GrillQube', 'BBQube'],
    discovery_gepland: ['Horecalicht', 'Webkarpet', 'Relax Outdoor', 'Jasper Verhey', 'BBQube'],
    discovery_plaatsgevonden: ['Bureau Hamers', 'Relax Outdoor'],
    offerte_verzonden: ['Bureau Hamers'],
  },
  '2026-02': {
    discovery_voorgesteld: [
      'Urban Green Innovations', 'Cornelis & Palmo', 'Talenti Outdoor', 'MOMÉ Lifestyle',
      'Schins Home', 'Bas Plus', 'Sunshield',
    ],
    discovery_gepland: [
      'Urban Green Innovations', 'Cornelis & Palmo', 'Talenti Outdoor', 'MOMÉ Lifestyle',
      'Schins Home', 'Bas Plus',
    ],
    discovery_plaatsgevonden: [
      'Jasper Verhey', 'BBQube', 'Cornelis & Palmo', 'Urban Green Innovations',
      'Bas Plus', 'MOMÉ Lifestyle', 'Horecalicht',
    ],
    offerte_verzonden: ['Relax Outdoor', 'Jasper Verhey', 'BBQube', 'Urban Green Innovations', 'Bas Plus'],
    offerte_aanvaard: ['Relax Outdoor'],
  },
  '2026-03': {
    discovery_voorgesteld: [
      'Macazz', 'Daniela Cupello', 'Van Drie Interieurbouw', 'Igor Custers', 'Equidee Design',
      'Studio Zar', 'Atlantika', 'Keukens de Abdij',
    ],
    discovery_gepland: [
      'Macazz', 'Van Drie Interieurbouw', 'Igor Custers', 'Equidee Design', 'Studio Zar', 'Keukens de Abdij',
    ],
    discovery_plaatsgevonden: ['Sunshield', 'Talenti Outdoor', 'Macazz', 'Equidee Design', 'Studio Zar'],
    offerte_verzonden: ['Horecalicht', 'Talenti Outdoor', 'Webkarpet', 'Macazz', 'Studio Zar'],
    offerte_aanvaard: ['Bas Plus', 'BBQube'],
    offerte_geweigerd: ['Webkarpet', 'Urban Green Innovations', 'Talenti Outdoor'],
  },
  '2026-04': {
    discovery_voorgesteld: ['Hout & Living', 'Oogenlust', 'Wellness Tuinier'],
    discovery_gepland: ['Atlantika', 'Hout & Living', 'Oogenlust'],
    discovery_plaatsgevonden: ['Atlantika'],
  },
  /** Discovery-sheet: mei-26 */
  '2026-05': {
    discovery_voorgesteld: [
      'Bespoke Design (MONIQUE)', 'Lagoon', 'Eric Kant', 'Zolderidee', 'Technohome',
    ],
    discovery_gepland: [
      'Bespoke Design (MONIQUE)', 'Lagoon', 'Eric Kant', 'Zolderidee', 'Technohome',
    ],
    discovery_plaatsgevonden: ['Hout & Living', 'Oogenlust'],
    offerte_verzonden: ['Atlantika', 'Oogenlust'],
    offerte_geweigerd: ['Jasper Verhey'],
  },
}

/** Overzicht: afgeleid uit klantlijsten (zelfde aantallen als Deals-subtotaal). */
export const manualOverviewByMonth: Record<string, ManualOverviewMonth> = Object.fromEntries(
  Object.entries(manualDealsByMonth).map(([ym, deals]) => {
    const cleared = offerteStagesEmptyForMonth(ym)
      ? { ...deals, offerte_verzonden: [], offerte_aanvaard: [] }
      : deals
    return [ym, overviewFromDeals(cleared)]
  }),
)

export function getManualDealsMonth(monthKey: string): ManualDealsMonth | null {
  const raw = manualDealsByMonth[monthKey]
  if (!raw) return null
  if (!offerteStagesEmptyForMonth(monthKey)) return raw
  const copy: ManualDealsMonth = { ...raw }
  for (const st of OFFERTE_STAGES) copy[st] = []
  return copy
}

export function getManualOverviewMonth(monthKey: string): ManualOverviewMonth | null {
  if (manualOverviewByMonth[monthKey]) return manualOverviewByMonth[monthKey]
  if (monthKey in manualDealsByMonth && isManualPipelineMonth(monthKey)) {
    return overviewFromDeals(getManualDealsMonth(monthKey) ?? {})
  }
  if (isManualPipelineMonth(monthKey) && is2024Month(monthKey)) return EMPTY_OVERVIEW
  return null
}

export function hasManualDealsData(monthKey: string): boolean {
  const m = getManualDealsMonth(monthKey)
  if (!m) return monthKey in manualDealsByMonth
  return Object.values(m).some((arr) => arr && arr.length > 0)
}

const ALL_MANUAL_DEAL_STAGES: ManualDealsStageId[] = [
  'leads_appointment_setting_selah',
  'discovery_voorgesteld',
  'discovery_gepland',
  'discovery_plaatsgevonden',
  'offerte_verzonden',
  'offerte_aanvaard',
  'offerte_geweigerd',
]

export function buildManualDealsByStage(monthKey: string): Record<ManualDealsStageId, DealRow[]> | null {
  const month = getManualDealsMonth(monthKey)
  if (monthKey in manualDealsByMonth) {
    const out = {} as Record<ManualDealsStageId, DealRow[]>
    for (const stageId of ALL_MANUAL_DEAL_STAGES) {
      out[stageId] = manualDealRows(monthKey, stageId, month?.[stageId] ?? [])
    }
    return out
  }
  return null
}
