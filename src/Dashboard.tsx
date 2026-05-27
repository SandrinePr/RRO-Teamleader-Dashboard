/**
 * Pagina "Deals en offertes": haalt deals (+ companies/contacts/users) van de API, cachet per maand,
 * toont funnel per geselecteerde periode via DealsOffertesExcel.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, type ApiListResponse, type DealRow, type CompanyRow, type ContactRow, type UserRow } from './api'
import { DealsOffertesExcel } from './components'
import {
  dealTouchesMonth,
  fetchAllPipelineDeals,
  pipelineSession,
} from './pipelineSession'
import { isManualPipelineMonth } from './manualPipeline'

const MAAND_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const CURRENT_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
const DEBUG_DEALS =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('debugDeals') === '1' ||
    window.localStorage.getItem('rro_debug_deals') === '1')

export function Dashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [loadingHint, setLoadingHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deals, setDeals] = useState<DealRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [period, setPeriod] = useState<string>(CURRENT_MONTH)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const dealsRequestSeq = useRef(0)
  const inFlightDeals = useRef<Partial<Record<string, Promise<DealRow[]>>>>({})
  const yearOptions: number[] = [2026, 2025, 2024]

  const monthTabs: { value: string; label: string }[] = (() => {
    const tabs: { value: string; label: string }[] = []
    for (let m = 1; m <= 12; m++) {
      const value = `${year}-${String(m).padStart(2, '0')}`
      tabs.push({ value, label: MAAND_LABELS[m - 1] })
    }
    return tabs
  })()

  const selectedMonths: { value: string; label: string }[] = (() => {
    if (period === 'all') return [{ value: 'all', label: 'Alle deals' }]
    const [yy, mm] = period.split('-')
    const m = Number(mm)
    if (!yy || Number.isNaN(m) || m < 1 || m > 12) return []
    return [{ value: period, label: `${MAAND_LABELS[m - 1]} ${yy}` }]
  })()

  useEffect(() => {
    const base = (import.meta.env.VITE_API_URL as string) || ''
    if (!base) {
      setError('VITE_API_URL niet gezet. Maak een .env met VITE_API_URL=http://localhost:5055')
      setLoading(false)
      return
    }
    Promise.all([
      apiGet<ApiListResponse<CompanyRow>>('/companies'),
      apiGet<ApiListResponse<ContactRow>>('/contacts'),
      apiGet<ApiListResponse<UserRow>>('/users'),
    ])
      .then(([co, ct, u]) => {
        setCompanies(co.data ?? [])
        setContacts(ct.data ?? [])
        setUsers(u.data ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ophalen mislukt'))
  }, [])

  function cacheKeyFor(targetPeriod: string): string {
    return targetPeriod === 'all' ? `all:${year}` : targetPeriod
  }

  function dealsForPeriodFromAll(allDeals: DealRow[], targetPeriod: string, monthKeys: string[]): DealRow[] {
    if (targetPeriod === 'all') {
      const merged: DealRow[] = []
      const seen = new Set<string>()
      for (const m of monthKeys) {
        for (const d of allDeals.filter((row) => dealTouchesMonth(row, m))) {
          const id = String((d as Record<string, unknown>).id ?? '')
          if (!id || seen.has(id)) continue
          seen.add(id)
          merged.push(d)
        }
      }
      return merged
    }
    return allDeals.filter((d) => dealTouchesMonth(d, targetPeriod))
  }

  async function fetchDealsForPeriod(targetPeriod: string): Promise<DealRow[]> {
    const key = cacheKeyFor(targetPeriod)
    if (pipelineSession.monthDealsCache[key]) {
      if (DEBUG_DEALS) console.info('[deals:cache-hit]', { period: targetPeriod, key, size: pipelineSession.monthDealsCache[key].length })
      return pipelineSession.monthDealsCache[key]
    }
    if (inFlightDeals.current[key]) {
      if (DEBUG_DEALS) console.info('[deals:inflight-hit]', { period: targetPeriod, key })
      return inFlightDeals.current[key]!
    }

    const monthKeys = monthTabs.map((t) => t.value)
    const request = (async () => {
      const allDeals = await fetchAllPipelineDeals()
      const rows = dealsForPeriodFromAll(allDeals, targetPeriod, monthKeys)
      if (DEBUG_DEALS) {
        console.info('[deals:from-session]', {
          period: targetPeriod,
          key,
          count: rows.length,
          allDeals: allDeals.length,
        })
      }
      pipelineSession.monthDealsCache[key] = rows
      return rows
    })()
      .catch((err) => {
        console.error('[deals:fetch-error]', {
          period: targetPeriod,
          key,
          error: err,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      })
      .finally(() => {
        delete inFlightDeals.current[key]
      })

    inFlightDeals.current[key] = request
    return request
  }

  useEffect(() => {
    const base = (import.meta.env.VITE_API_URL as string) || ''
    if (!base) return

    const key = cacheKeyFor(period)
    if (period !== 'all' && isManualPipelineMonth(period)) {
      setDeals([])
      setLoading(false)
      setLoadingHint(null)
      setError(null)
      return
    }

    if (pipelineSession.monthDealsCache[key]) {
      setDeals(pipelineSession.monthDealsCache[key])
      setLoading(false)
      setLoadingHint(null)
      return
    }

    const seq = ++dealsRequestSeq.current
    setLoading(true)
    setLoadingHint(
      pipelineSession.allDeals
        ? `${year}: deals filteren…`
        : 'Teamleader: deals ophalen (gedeeld met Overzicht)…',
    )

    fetchDealsForPeriod(period)
      .then((rows) => {
        if (seq !== dealsRequestSeq.current) return
        if (DEBUG_DEALS) console.info('[deals:set-state]', { period, seq, rows: rows.length })
        setDeals(rows)
        setError(null)
      })
      .catch((e) => {
        if (seq !== dealsRequestSeq.current) return
        console.error('[deals:ui-error]', { period, seq, error: e, message: e instanceof Error ? e.message : String(e) })
        setError(e instanceof Error ? e.message : 'Ophalen mislukt')
      })
      .finally(() => {
        if (seq === dealsRequestSeq.current) {
          setLoadingHint(null)
          setLoading(false)
        }
      })
  }, [period, year])

  if (loading) {
    return (
      <div className="dashboard">
        <p>Bezig met ophalen…{loadingHint ? ` ${loadingHint}` : ''}</p>
      </div>
    )
  }
  if (error) return <div className="dashboard"><p className="dashboard-error">{error}</p></div>

  return (
    <div className="dashboard dashboard-deals-only rro-overview">
      <div className="rro-tabs">
        <button className="rro-tab" type="button" onClick={() => navigate('/')}>Overzicht</button>
        <button className="rro-tab rro-tab-active" type="button" onClick={() => navigate('/deals')}>Deals en offertes</button>
        <button className="rro-tab" type="button" onClick={() => navigate('/sales-activity')}>Sales activiteit</button>
      </div>
      <div className="deals-offertes-toolbar">
        <div className="deals-offertes-controls">
          <label className="pipeline-month-label">
            Jaar:
            <select
              value={String(year)}
              onChange={(e) => {
                const y = Number(e.target.value)
                setYear(y)
                const now = new Date()
                const month =
                  y === now.getFullYear()
                    ? now.getMonth() + 1
                    : 1
                setPeriod(`${y}-${String(month).padStart(2, '0')}`)
              }}
              className="pipeline-month-select"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div className="deals-offertes-month-tabs" role="tablist" aria-label="Maanden">
            {monthTabs.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`month-tab${period === t.value ? ' month-tab-active' : ''}`}
                onClick={() => setPeriod(t.value)}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className={`month-tab${period === 'all' ? ' month-tab-active' : ''}`}
              onClick={() => setPeriod('all')}
            >
              Alle
            </button>
          </div>
        </div>
      </div>
      <DealsOffertesExcel
        deals={deals}
        companies={companies}
        contacts={contacts}
        users={users}
        selectedMonths={selectedMonths}
        year={year}
      />
    </div>
  )
}