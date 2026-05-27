/**
 * API helpers + Teamleader types + fase-mapping.
 */

const BASE = (import.meta.env.VITE_API_URL as string) || ''
const DEBUG_FETCH =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('debugDeals') === '1' ||
    window.localStorage.getItem('rro_debug_deals') === '1')

export async function apiGet<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`
  if (DEBUG_FETCH) console.info('[apiGet:start]', { path, url })
  const res = await fetch(url)
  const json = (await res.json().catch(() => ({}))) as T & { _error?: string }
  if (DEBUG_FETCH) {
    console.info('[apiGet:done]', {
      path,
      status: res.status,
      ok: res.ok,
      hasDataArray: Array.isArray((json as { data?: unknown }).data),
      dataLen: Array.isArray((json as { data?: unknown[] }).data) ? (json as { data?: unknown[] }).data?.length : undefined,
      apiError: json._error ?? null,
    })
  }
  if (!res.ok) {
    const msg = json._error ?? `API ${path}: ${res.status}`
    console.error('[apiGet:error]', {
      path,
      url,
      status: res.status,
      statusText: res.statusText,
      payload: json,
      message: msg,
    })
    throw new Error(msg)
  }
  if (json._error) {
    console.warn('[apiGet:warning_payload_error]', { path, payloadError: json._error, payload: json })
  }
  return json as T
}

/** Gebruik voor optionele endpoints: faalt met `null` i.p.v. throw. */
export async function apiGetAllowFail<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`)
    const json = (await res.json().catch(() => ({}))) as T
    if (!res.ok) return null
    return json as T
  } catch {
    return null
  }
}

export interface ApiListResponse<T> {
  data: T[]
}

export type DealRow = Record<string, unknown> & {
  title?: string
  total?: number
  status?: string
  currency?: string
  created_at?: string
  updated_at?: string
  responsible_user_id?: string
  /** Huidige fase-id of fase-naam. */
  phase_id?: string
  phase_name?: string
  /** Sommige payloads sturen de fase als object. */
  phase?: { name?: string; id?: string }
  /** Standaard bron in `deals.list`. */
  current_phase?: { type?: string; id?: string; name?: string }
  /** Lead-relatie voor company/contact. */
  lead?: {
    customer?: { type?: string; id?: string }
    contact_person?: { type?: string; id?: string }
  }
  /** Verrijkte bedrijfsnaam uit API. */
  company_name?: string
}

/** Volledige pipeline voor dashboard-weergave. */
export const PIPELINE_STAGES = [
  { id: 'lead_gekwalificeerd', label: 'Lead gekwalificeerd' },
  { id: 'leads_appointment_setting_selah', label: 'Leads Appointment Setting Selah' },
  { id: 'discovery_voorgesteld', label: 'Discovery call voorgesteld' },
  { id: 'discovery_gepland', label: 'Discovery call gepland' },
  { id: 'discovery_plaatsgevonden', label: 'Discovery call plaatsgevonden' },
  { id: 'offerte_verzonden', label: 'Offerte verzonden' },
  { id: 'later_opvolgen', label: 'Later nogmaals opvolgen' },
  { id: 'offerte_aanvaard', label: 'Offerte aanvaard' },
  { id: 'offerte_geweigerd', label: 'Offerte geweigerd' },
  { id: 'niet_geinteresseerd', label: 'Niet geïnteresseerd' },
] as const

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]['id']

/** Beperkte set kolommen voor Deals & Offertes. */
export const DEALS_OFFERTES_STAGES = [
  { id: 'leads_appointment_setting_selah', label: 'Leads Appointment Setting Selah' },
  { id: 'discovery_voorgesteld', label: 'Discovery voorgesteld' },
  { id: 'discovery_gepland', label: 'Discovery ingepland' },
  { id: 'discovery_plaatsgevonden', label: 'Discovery plaatsgevonden' },
  { id: 'offerte_verzonden', label: 'Offerte verzonden' },
  { id: 'offerte_aanvaard', label: 'Offerte geaccepteerd' },
  { id: 'offerte_geweigerd', label: 'Offerte afgewezen' },
] as const

// Bekende Teamleader phase-id's die direct naar onze stages mappen.
const PHASE_LEADS_APPOINTMENT_SETTING_SELAH = 'cfcab239-a580-0baa-886c-ab6c07139f56'
const PHASE_DISCOVERY_VOORGESTELD_IDS = [
  '43dbb965-8ce4-0e68-ad61-386a1e1119c8',
]
const PHASE_DISCOVERY_INGEPLAND = '0385e81d-8526-0ebe-926f-f33c611119c9'
const PHASE_DISCOVERY_PLAATSGEVONDEN = '1e7c4d04-ba14-0f20-866f-3823fe136cb6'
const PHASE_OFFERTES_VERZONDEN = '393c9be5-8374-0ceb-bf63-6038a31119ca'
const PHASE_LATER_OPVOLGEN = '7910eb21-2887-02e7-aa68-b95f611243eb'
const PHASE_NIET_GEINTERESSEERD = 'baaa9659-17d4-0f35-9268-e6d784116680'
const PHASE_OFFERTES_GEWEIGERD = '8d3c023d-216a-0057-a362-75e6d81119cc'
const PHASE_OFFERTES_GEAANVAARD_PREFIX = 'f084a9bc'

/** Bepaalt de stage op basis van naam, id en status (in die volgorde). */
export function getDealPipelineStage(deal: DealRow): PipelineStageId | null {
  // Pak id/naam uit de meest betrouwbare bron die beschikbaar is.
  const phaseId =
    (typeof deal.current_phase === 'object' && deal.current_phase?.id
      ? String(deal.current_phase.id)
      : '') ||
    (typeof deal.phase === 'object' && deal.phase?.id
      ? String(deal.phase.id)
      : '') ||
    (deal.phase_id ? String(deal.phase_id) : '')

  const phaseName = (
    (typeof deal.current_phase === 'object' && deal.current_phase?.name
      ? String(deal.current_phase.name)
      : '') ||
    (typeof deal.phase === 'object' && deal.phase?.name
      ? String(deal.phase.name)
      : '') ||
    (deal.phase_name ? String(deal.phase_name) : '')
  ).toLowerCase()

  const status = (deal.status ? String(deal.status) : '').toLowerCase()

  // 1) Eerst match op naam.
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
  if (phaseName.includes('later nogmaals opvolgen')) return 'later_opvolgen'
  if (phaseName.includes('niet geinteresseerd') || phaseName.includes('niet geïnteresseerd'))
    return 'niet_geinteresseerd'
  if (phaseName.includes('offerte aanvaard') || phaseName.includes('offerte geaccepteerd'))
    return 'offerte_aanvaard'
  if (phaseName.includes('offerte geweigerd') || phaseName.includes('offerte afgewezen'))
    return 'offerte_geweigerd'

  // 2) Daarna fallback op bekende phase-id's.
  if (phaseId === PHASE_LEADS_APPOINTMENT_SETTING_SELAH) return 'leads_appointment_setting_selah'
  if (PHASE_DISCOVERY_VOORGESTELD_IDS.includes(phaseId)) return 'discovery_voorgesteld'
  if (phaseId === PHASE_DISCOVERY_INGEPLAND) return 'discovery_gepland'
  if (phaseId === PHASE_DISCOVERY_PLAATSGEVONDEN) return 'discovery_plaatsgevonden'
  if (phaseId === PHASE_OFFERTES_VERZONDEN) return 'offerte_verzonden'
  if (phaseId === PHASE_LATER_OPVOLGEN) return 'later_opvolgen'
  if (phaseId === PHASE_NIET_GEINTERESSEERD) return 'niet_geinteresseerd'
  if (phaseId === PHASE_OFFERTES_GEWEIGERD) return 'offerte_geweigerd'
  if (phaseId.startsWith(PHASE_OFFERTES_GEAANVAARD_PREFIX)) return 'offerte_aanvaard'

  // 3) Laatste fallback op dealstatus.
  if (status === 'won') return 'offerte_aanvaard'
  if (status === 'lost') return 'offerte_geweigerd'

  return null
}

export type ContactRow = Record<string, unknown> & {
  id?: string
  first_name?: string
  last_name?: string
  email?: string
  company_name?: string
  /** Company-relatie voor naam-resolutie. */
  company?: { id?: string; name?: string }
  created_at?: string
  updated_at?: string
}

export type CompanyRow = Record<string, unknown> & {
  id?: string
  name?: string
  email?: string
  created_at?: string
  updated_at?: string
}

export type UserRow = Record<string, unknown> & {
  first_name?: string
  last_name?: string
  email?: string
}

export type TaskRow = Record<string, unknown> & {
  title?: string
  due_on?: string
  status?: string
  assignee_id?: string
}
