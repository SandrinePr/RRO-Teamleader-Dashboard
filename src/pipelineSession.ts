/**
 * Gedeelde Teamleader pipeline-cache (Overzicht + Deals en offertes).
 * Blijft in geheugen bij tab-wissels; voorkomt 12× zware ?month= API-calls per jaar.
 */

import { apiGet, type ApiListResponse, type DealRow } from './api'

export const NEW_CUSTOMERS_PIPELINE_ID = 'f2d4af30-1e5d-054b-a54c-1b91b0b57200'

export const pipelineSession = {
  allDeals: null as DealRow[] | null,
  inFlight: null as Promise<DealRow[]> | null,
  /** Deals per maand/jaar-key (Dashboard). */
  monthDealsCache: {} as Record<string, DealRow[]>,
}

export function toMonthKey(raw: string): string | null {
  if (!raw) return null
  const isoLike = raw.trim()
  if (/^\d{4}-\d{2}/.test(isoLike)) return isoLike.slice(0, 7)
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function dealTouchesMonth(deal: DealRow, yearMonth: string): boolean {
  const anyDeal = deal as Record<string, unknown>
  for (const k of ['updated_at', 'closed_at', 'created_at']) {
    if (toMonthKey(String(anyDeal[k] ?? '')) === yearMonth) return true
  }
  const hist = anyDeal.phase_history as Array<{ started_at?: string }> | undefined
  if (Array.isArray(hist)) {
    for (const entry of hist) {
      if (toMonthKey(String(entry.started_at ?? '')) === yearMonth) return true
    }
  }
  return false
}

export function filterNewCustomersPipeline(rows: DealRow[]): DealRow[] {
  return rows.filter((deal) => {
    const anyDeal = deal as Record<string, unknown>
    const p = (anyDeal.pipeline as Record<string, unknown> | undefined) ?? undefined
    const pipelineId = p?.id != null ? String(p.id) : ''
    return pipelineId === NEW_CUSTOMERS_PIPELINE_ID
  })
}

export async function fetchAllPipelineDeals(): Promise<DealRow[]> {
  if (pipelineSession.allDeals) return pipelineSession.allDeals
  if (pipelineSession.inFlight) return pipelineSession.inFlight

  const req = apiGet<ApiListResponse<DealRow>>('/deals-with-companies')
    .then((res) => {
      const rows = filterNewCustomersPipeline(res.data ?? [])
      pipelineSession.allDeals = rows
      return rows
    })
    .finally(() => {
      pipelineSession.inFlight = null
    })

  pipelineSession.inFlight = req
  return req
}

export function clearPipelineSession(): void {
  pipelineSession.allDeals = null
  pipelineSession.inFlight = null
  pipelineSession.monthDealsCache = {}
}
