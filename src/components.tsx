/** Gedeelde dashboardcomponenten en Deals & Offertes overzicht. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { DealRow, ContactRow, CompanyRow, UserRow } from './api'
import { PIPELINE_STAGES, DEALS_OFFERTES_STAGES, getDealPipelineStage } from './api'
import { stagesReachedInMonth } from './pipelineMonthOverview'
import { buildManualDealsByStage } from './manualPipeline'
import { stageTargetsByIdForYear } from './pipelineTargets'
import { fetchEnrichedDealsForMonth, clearPipelineSession } from './pipelineSession'
import { isManualPipelineMonth } from './manualPipeline'
import redRockWordmark from './assets/red-rock-wordmark.svg'

const CHART_COLORS = ['#4a9eff', '#6bcf7f', '#e57373', '#f0ad4e', '#9b59b6']

export function Layout() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const auth = params.get('auth')
    if (auth === 'ok') {
      clearPipelineSession()
      params.delete('auth')
      const qs = params.toString()
      window.location.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`)
      return
    }
    if (auth === 'failed' || auth === 'no_token') {
      params.delete('auth')
      const qs = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
      window.alert('Inloggen bij Teamleader is mislukt. Probeer opnieuw via /auth/login.')
    }
  }, [])

  useEffect(() => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    if (!isManualPipelineMonth(ym)) {
      void fetchEnrichedDealsForMonth(ym).catch(() => {})
    }
  }, [])

  return (
    <div className="layout">
      <header className="layout-header">
        <img className="layout-logo" src={redRockWordmark} alt="Red Rock" />
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  )
}

interface WidgetProps {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}

export function Widget({ title, subtitle, children, className = '' }: WidgetProps) {
  return (
    <div className={`widget ${className}`}>
      <div className="widget-header">
        <h3 className="widget-title">{title}</h3>
        {subtitle && <span className="widget-subtitle">{subtitle}</span>}
      </div>
      <div className="widget-body">{children}</div>
    </div>
  )
}

export function KpiCards({ users, deals, contacts, companies }: { users: number; deals: number; contacts: number; companies: number }) {
  const items = [
    { label: 'Gebruikers', value: users },
    { label: 'Deals', value: deals },
    { label: 'Contacten', value: contacts },
    { label: 'Bedrijven', value: companies },
  ]
  return (
    <div className="kpi-cards">
      {items.map(({ label, value }) => (
        <div key={label} className="kpi-card">
          <span className="kpi-value">{value}</span>
          <span className="kpi-label">{label}</span>
        </div>
      ))}
    </div>
  )
}

export interface TableColumn<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
}

export function DataTable<T extends Record<string, unknown>>({
  title,
  columns,
  data,
  getKey,
}: {
  title?: string
  columns: TableColumn<T>[]
  data: T[]
  getKey: (row: T) => string
}) {
  return (
    <div className="data-table-wrap">
      {title ? <h3>{title}</h3> : null}
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={columns.length}>Geen data</td></tr>
            ) : (
              data.map((row) => (
                <tr key={getKey(row)}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmtEuro(n: number) {
  return '€ ' + n.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
}

export function SalesSummary({ deals }: { deals: DealRow[] }) {
  const withTotal = (d: DealRow) => Number(d.total ?? 0)
  const open = deals.filter((d) => (d.status as string)?.toLowerCase() === 'open')
  const won = deals.filter((d) => (d.status as string)?.toLowerCase() === 'won')
  const lost = deals.filter((d) => (d.status as string)?.toLowerCase() === 'lost')
  const openValue = open.reduce((s, d) => s + withTotal(d), 0)
  const wonValue = won.reduce((s, d) => s + withTotal(d), 0)
  const lostValue = lost.reduce((s, d) => s + withTotal(d), 0)
  const totalValue = openValue + wonValue + lostValue
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

  return (
    <div className="sales-overzicht">
      <div className="sales-overzicht-row">
        <div className="sales-kpi">
          <span className="sales-kpi-label">Pipeline (open)</span>
          <span className="sales-kpi-value sales-kpi-open">{fmtEuro(openValue)}</span>
          <span className="sales-kpi-meta">{open.length} deals</span>
        </div>
        <div className="sales-kpi">
          <span className="sales-kpi-label">Gewonnen</span>
          <span className="sales-kpi-value sales-kpi-won">{fmtEuro(wonValue)}</span>
          <span className="sales-kpi-meta">{won.length} deals</span>
        </div>
        <div className="sales-kpi">
          <span className="sales-kpi-label">Verloren</span>
          <span className="sales-kpi-value sales-kpi-lost">{fmtEuro(lostValue)}</span>
          <span className="sales-kpi-meta">{lost.length} deals</span>
        </div>
      </div>
      <div className="sales-overzicht-row">
        <div className="sales-kpi">
          <span className="sales-kpi-label">Totaal waarde</span>
          <span className="sales-kpi-value">{fmtEuro(totalValue)}</span>
        </div>
        <div className="sales-kpi">
          <span className="sales-kpi-label">Win rate</span>
          <span className="sales-kpi-value">{winRate}%</span>
          <span className="sales-kpi-meta">{won.length} gewonnen / {lost.length} verloren</span>
        </div>
      </div>
    </div>
  )
}

export function DealStatusPie({ deals }: { deals: DealRow[] }) {
  const byStatus: Record<string, number> = {}
  for (const d of deals) {
    const s = (d.status as string) || 'Onbekend'
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  const data = Object.entries(byStatus).map(([name, value]) => ({ name, value }))
  const total = data.reduce((a, b) => a + b.value, 0)

  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="donut-center">{total}</text>
          <Tooltip formatter={(v) => [v ?? 0, 'deals']} />
          <Legend layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ProgressRing({ value, total, label, sublabel }: { value: number; total: number; label: string; sublabel?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const r = 44
  const circ = 2 * Math.PI * r
  const stroke = (pct / 100) * circ

  return (
    <div className="progress-ring-wrap">
      <svg viewBox="0 0 100 100" className="progress-ring-svg">
        <circle className="progress-ring-bg" cx="50" cy="50" r={r} fill="none" strokeWidth="8" />
        <circle className="progress-ring-fill" cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeDasharray={circ} strokeDashoffset={circ - stroke} transform="rotate(-90 50 50)" />
      </svg>
      <div className="progress-ring-center">
        <span className="progress-ring-pct">{pct}%</span>
        <span className="progress-ring-label">{label}</span>
        {sublabel && <span className="progress-ring-sublabel">{sublabel}</span>}
      </div>
    </div>
  )
}

export function DealStatusBar({ deals }: { deals: DealRow[] }) {
  const byStatus: Record<string, number> = {}
  for (const d of deals) {
    const s = (d.status as string) || 'Onbekend'
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  const data = Object.entries(byStatus).map(([name, aantal]) => ({ name, aantal }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="aantal" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TopDealsList({ deals }: { deals: DealRow[] }) {
  const withTotal = deals.filter((d) => d.total != null && Number(d.total) > 0)
  const sorted = [...withTotal].sort((a, b) => Number(b.total) - Number(a.total))
  const top = sorted.slice(0, 5)
  const medals = ['1', '2', '3', '4', '5']

  return (
    <div className="top-deals">
      {top.length === 0 ? (
        <p className="top-deals-empty">Geen deals met bedrag</p>
      ) : (
        top.map((d, i) => (
          <div key={i} className="top-deals-item">
            <span className="top-deals-rank">{medals[i]}</span>
            <div className="top-deals-info">
              <span className="top-deals-title">{String(d.title ?? 'Deal')}</span>
              <span className="top-deals-meta">{String(d.status ?? '')}</span>
            </div>
            <span className="top-deals-value">{Number(d.total ?? 0).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}</span>
          </div>
        ))
      )}
    </div>
  )
}

function sortKey(d: { created_at?: string; updated_at?: string; id?: unknown }) {
  return d.created_at || d.updated_at || String(d.id ?? '')
}

export function RecentItems({ deals, contacts, companies }: { deals: DealRow[]; contacts: ContactRow[]; companies: CompanyRow[] }) {
  const dealItems = [...deals].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 5)
    .map((d) => ({ type: 'Deal' as const, title: String(d.title ?? '—'), meta: d.status ? `€ ${Number(d.total ?? 0).toLocaleString('nl-NL')} · ${d.status}` : '' }))
  const contactItems = [...contacts].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 5)
    .map((c) => ({ type: 'Contact' as const, title: [c.first_name, c.last_name].filter(Boolean).join(' ') || '—', meta: String(c.email ?? '') }))
  const companyItems = [...companies].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 5)
    .map((co) => ({ type: 'Bedrijf' as const, title: String(co.name ?? '—'), meta: String(co.email ?? '') }))
  const hasAny = dealItems.length + contactItems.length + companyItems.length > 0

  return (
    <div className="recent-aangemaakt">
      {!hasAny ? (
        <p className="recent-empty">Geen recente items</p>
      ) : (
        <ul className="recent-list">
          {dealItems.map((x, i) => (
            <li key={`d-${i}`} className="recent-item">
              <span className="recent-type recent-type-deal">{x.type}</span>
              <span className="recent-title">{x.title}</span>
              {x.meta && <span className="recent-meta">{x.meta}</span>}
            </li>
          ))}
          {contactItems.map((x, i) => (
            <li key={`c-${i}`} className="recent-item">
              <span className="recent-type recent-type-contact">{x.type}</span>
              <span className="recent-title">{x.title}</span>
              {x.meta && <span className="recent-meta">{x.meta}</span>}
            </li>
          ))}
          {companyItems.map((x, i) => (
            <li key={`co-${i}`} className="recent-item">
              <span className="recent-type recent-type-company">{x.type}</span>
              <span className="recent-title">{x.title}</span>
              {x.meta && <span className="recent-meta">{x.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function WonDealsList({ deals }: { deals: DealRow[] }) {
  const withTotal = deals.filter((d) => d.total != null && Number(d.total) > 0)
  const sorted = [...withTotal].sort((a, b) => Number(b.total) - Number(a.total))
  const top = sorted.slice(0, 6)
  const totalValue = top.reduce((s, d) => s + Number(d.total ?? 0), 0)
  const won = deals.filter((d) => (d.status as string)?.toLowerCase() === 'won').length
  const lost = deals.filter((d) => (d.status as string)?.toLowerCase() === 'lost').length
  const winRate = deals.length > 0 ? Math.round((won / (won + lost || 1)) * 100) : 0

  return (
    <div className="won-deals-table">
      <div className="won-deals-summary">
        <div className="won-deals-row">
          <span>Waarde gewonnen</span>
          <strong>{fmtEuro(totalValue)}</strong>
        </div>
        <div className="won-deals-row">
          <span>Gewonnen / Verloren</span>
          <strong>{won} / {lost}</strong>
        </div>
        <div className="won-deals-row">
          <span>Win rate</span>
          <strong>{winRate}%</strong>
        </div>
      </div>
      <div className="won-deals-list">
        {top.map((d, i) => (
          <div key={i} className="won-deals-item">
            <span className="won-deals-value">{fmtEuro(Number(d.total ?? 0))}</span>
            <span className="won-deals-title">{String(d.title ?? '—')}</span>
            <span className="won-deals-status">{String(d.status ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Filter op maand (`YYYY-MM`) of geef alles terug bij `null`. */
function filterDealsByMonth(deals: DealRow[], monthFilter: string | null): DealRow[] {
  if (!monthFilter) return deals
  return deals.filter((d) => {
    const raw = d.created_at ?? d.updated_at ?? ''
    if (!raw) return false
    const date = new Date(raw)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}` === monthFilter
  })
}

function formatEuroPipeline(n: number) {
  return '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PipelineDiscoveryOfferte({ deals, monthFilter }: { deals: DealRow[]; monthFilter: string | null }) {
  const filtered = filterDealsByMonth(deals, monthFilter)
  const byStage: Record<string, number> = {}
  const byStageValue: Record<string, number> = {}
  for (const id of PIPELINE_STAGES.map((s) => s.id)) {
    byStage[id] = 0
    byStageValue[id] = 0
  }
  for (const d of filtered) {
    const stage = getDealPipelineStage(d)
    if (stage && stage in byStage) {
      byStage[stage]++
      byStageValue[stage] += Number(d.total ?? 0)
    }
  }
  const totalDeals = filtered.length
  const totalValue = Object.values(byStageValue).reduce((a, b) => a + b, 0)
  const offerteVerzonden = byStage.offerte_verzonden ?? 0
  const offerteBase = offerteVerzonden || 1
  const isOfferteOutcome = (id: string) => id === 'offerte_aanvaard' || id === 'offerte_geweigerd'

  return (
    <div className="pipeline-discovery">
      <div className="pipeline-discovery-summary">
        <strong>{totalDeals.toLocaleString('nl-NL')} deals</strong>
        <span className="pipeline-discovery-summary-value">{formatEuroPipeline(totalValue)}</span>
      </div>
      <table className="pipeline-discovery-table">
        <thead>
          <tr>
            <th>Fase</th>
            <th>Aantal</th>
            <th>Totaal waarde</th>
            <th>% van totaal</th>
            <th>% van offertes</th>
          </tr>
        </thead>
        <tbody>
          {PIPELINE_STAGES.map(({ id, label }) => {
            const count = byStage[id] ?? 0
            const value = byStageValue[id] ?? 0
            const pctTotal = totalDeals > 0 ? Math.round((count / totalDeals) * 100) : 0
            const pctOfferte = isOfferteOutcome(id) ? Math.round((count / offerteBase) * 100) : null
            return (
              <tr key={id}>
                <td>{label}</td>
                <td>{count}</td>
                <td>{formatEuroPipeline(value)}</td>
                <td>{pctTotal}%</td>
                <td>{pctOfferte != null ? `${pctOfferte}%` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {totalDeals === 0 && (
        <p className="pipeline-discovery-empty">
          Geen deals in {monthFilter ? `deze periode` : 'de pipeline'}.
        </p>
      )}
    </div>
  )
}

export function DealsOffertesExcel({
  deals,
  companies,
  contacts,
  users,
  selectedMonths,
  year,
}: {
  deals: DealRow[]
  companies: CompanyRow[]
  contacts: ContactRow[]
  users: UserRow[]
  selectedMonths: { value: string; label: string }[]
  year: number
}) {
  const [search] = useState('')
  const [owner] = useState<string>('all')
  const [status] = useState<string>('all')
  const [sort] = useState<string>('name_asc')
  const [onlyStaleOffers] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null)
  const debugEnabled =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('debugDeals') === '1' ||
      window.localStorage.getItem('rro_debug_deals') === '1')
  const stageTargetById = useMemo(() => stageTargetsByIdForYear(year), [year])

  const userNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const u of users ?? []) {
      const anyUser = u as Record<string, unknown>
      const id = (anyUser.id != null ? String(anyUser.id) : '') || ''
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.email ? String(u.email) : '')
      if (id && name) map[id] = name
    }
    return map
  }, [users])

  /** Rood = ≥3 maanden in fase offerte verzonden (datum uit phase_history). */
  const STALE_OFFERTE_DAYS = 90

  const offerteVerzondenSince = (deal: DealRow): Date | null => {
    const anyDeal = deal as Record<string, unknown>
    const hist = anyDeal.phase_history as Array<Record<string, unknown>> | undefined
    if (Array.isArray(hist)) {
      let latest: Date | null = null
      for (const entry of hist) {
        const phase = (entry.phase as Record<string, unknown> | undefined) ?? undefined
        const phaseId = String(phase?.id ?? '').toLowerCase()
        const phaseName = String(phase?.name ?? '').toLowerCase()
        const isVerzonden =
          phaseId === '393c9be5-8374-0ceb-bf63-6038a31119ca' ||
          phaseName.includes('offerte verzonden')
        if (!isVerzonden) continue
        const startedAt = String(entry.started_at ?? '')
        if (!startedAt) continue
        const d = new Date(startedAt)
        if (Number.isNaN(d.getTime())) continue
        if (!latest || d > latest) latest = d
      }
      if (latest) return latest
    }
    const raw = (anyDeal.updated_at as string | undefined) ?? deal.updated_at ?? deal.created_at ?? ''
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const isStaleOffer = (deal: DealRow) => {
    const stage = getDealPipelineStage(deal)
    if (stage !== 'offerte_verzonden') return false
    const since = offerteVerzondenSince(deal)
    if (!since) return false
    const ageDays = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)
    return ageDays >= STALE_OFFERTE_DAYS
  }

  const dealDisplayName = (deal: DealRow, companyNameById: Record<string, string>, contactCompanyNameById: Record<string, string>): string => {
    const anyDeal = deal as Record<string, unknown>
    const leadCustomerType = deal.lead?.customer?.type
    const customerIdRaw =
      deal.lead?.customer?.id ??
      (anyDeal.company_id as string | number | undefined) ??
      (anyDeal.customer_id as string | number | undefined) ??
      (anyDeal.company as Record<string, unknown> | undefined)?.id

    const customerId = customerIdRaw != null ? String(customerIdRaw) : ''
    let companyName: string | undefined

    if (customerId) {
      if (leadCustomerType === 'company') companyName = companyNameById[customerId]
      else if (leadCustomerType === 'contact') companyName = contactCompanyNameById[customerId]
    }
    if (!companyName && customerId) companyName = companyNameById[customerId] ?? contactCompanyNameById[customerId]

    return (
      deal.company_name ||
      companyName ||
      String(deal.title ?? '—')
    )
  }

  const matchesFilters = (deal: DealRow, displayName: string) => {
    const s = search.trim().toLowerCase()
    if (s) {
      const hay = `${displayName} ${String(deal.title ?? '')}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    if (owner !== 'all') {
      if (String(deal.responsible_user_id ?? '') !== owner) return false
    }
    if (status !== 'all') {
      const st = String(deal.status ?? '').toLowerCase()
      if (st !== status) return false
    }
    if (onlyStaleOffers && !isStaleOffer(deal)) return false
    return true
  }

  const sortDeals = (arr: DealRow[], displayNameOf: (d: DealRow) => string) => {
    const copy = [...arr]
    copy.sort((a, b) => {
      if (sort === 'name_desc') return displayNameOf(b).localeCompare(displayNameOf(a), 'nl')
      if (sort === 'amount_asc') return Number(a.total ?? 0) - Number(b.total ?? 0)
      if (sort === 'amount_desc') return Number(b.total ?? 0) - Number(a.total ?? 0)
      if (sort === 'updated_desc') {
        const aa = new Date(String((a as Record<string, unknown>).updated_at ?? a.updated_at ?? a.created_at ?? '')).getTime()
        const bb = new Date(String((b as Record<string, unknown>).updated_at ?? b.updated_at ?? b.created_at ?? '')).getTime()
        return (Number.isNaN(bb) ? 0 : bb) - (Number.isNaN(aa) ? 0 : aa)
      }
      // Standaard sortering.
      return displayNameOf(a).localeCompare(displayNameOf(b), 'nl')
    })
    return copy
  }

  function toMonthKey(raw: string): string | null {
    if (!raw) return null
    // Lees maand direct uit de ruwe string om timezone-shifts te vermijden.
    const isoLike = raw.trim()
    if (/^\d{4}-\d{2}/.test(isoLike)) return isoLike.slice(0, 7)
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }

  function normalizeKindValue(v: unknown): string {
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'string') return v.trim().toLowerCase()
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      const s = o.name ?? o.label ?? o.value ?? ''
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

  function isOldCustomer(deal: DealRow): { old: boolean; source: string; value: string } {
    const k = customerKindOf(deal)
    if (!k) return { old: false, source: '', value: '' }
    const v = k.value
    const src = k.source.toLowerCase()
    const oldValues = new Set(['oud', 'old', 'bestaand', 'existing customer', 'bestaande klant'])
    if (oldValues.has(v)) return { old: true, source: k.source, value: v }
    if ((src.includes('is_new') || src.includes('new_customer')) && v === 'false')
      return { old: true, source: k.source, value: v }
    if (src.includes('existing') && v === 'true')
      return { old: true, source: k.source, value: v }
    return { old: false, source: k.source, value: v }
  }

  return (
    <div className="deals-offertes-excel">
      {/* 1) Tabel bovenaan */}
      {selectedMonths.map(({ value, label }) => {
        const debugLines: string[] = []
        const dbg = (line: string) => {
          if (!debugEnabled) return
          if (debugLines.length < 800) debugLines.push(line)
        }
        dbg(`=== DEBUG ${label} (${value}) ===`)
        dbg(`deals_in_payload=${deals.length}`)
        const manualByStage = value !== 'all' ? buildManualDealsByStage(value) : null
        const useSnapshotMonth = Boolean(manualByStage)
        if (useSnapshotMonth) dbg(`snapshot_month=true`)
        const inMonth = useSnapshotMonth ? [] : deals
        const byStageActual: Record<string, DealRow[]> = {}
        for (const { id } of DEALS_OFFERTES_STAGES) {
          byStageActual[id] = useSnapshotMonth && manualByStage
            ? (manualByStage[id as keyof typeof manualByStage] ?? [])
            : []
        }
        const rowDealCandidates: DealRow[] = []

        let monthRowsWithoutStage = 0
        let monthRowsFallbackPlaced = 0
        let monthRowsUnknownStage = 0
        let monthRowsWeakCurrentStage = 0

        const dealTouchesMonth = (d: DealRow, monthKey: string): boolean => {
          const anyDeal = d as Record<string, unknown>
          for (const k of ['updated_at', 'closed_at', 'created_at']) {
            if (toMonthKey(String(anyDeal[k] ?? '')) === monthKey) return true
          }
          return false
        }

        if (!useSnapshotMonth) for (const d of inMonth) {
          const dealId = String((d as Record<string, unknown>).id ?? '')
          const displayRaw = String(d.company_name ?? d.title ?? dealId)

          // 1) Alleen deals tonen die deze maand een stage bereikten.
          if (value !== 'all') {
            const reached = stagesReachedInMonth(d, value)
            const reachedList = [...reached]
            dbg(`${dealId} | ${displayRaw} | reached_in_month=[${reachedList.join(',') || '-'}]`)
            let fallbackAsFirstVisible = false
            if (reachedList.length === 0) {
              monthRowsWithoutStage++
              const hasHistory = Array.isArray((d as Record<string, unknown>).phase_history) && ((d as Record<string, unknown>).phase_history as unknown[]).length > 0
              const createdMonth = toMonthKey(String(d.created_at ?? ''))
              const fallbackStage = getDealPipelineStage(d)

              // Zonder phase_history: toon in huidige fase-kolom als de API deze deal al in deze maand-cohort heeft (datums).
              if (
                !hasHistory &&
                fallbackStage &&
                fallbackStage !== 'offerte_aanvaard' &&
                fallbackStage !== 'offerte_geweigerd' &&
                byStageActual[fallbackStage] &&
                dealTouchesMonth(d, value)
              ) {
                const oldW = isOldCustomer(d)
                if (oldW.old) {
                  dbg(`${dealId} | ${displayRaw} | skipped_old_customer(weak_current) source=${oldW.source} value=${oldW.value}`)
                  continue
                }
                rowDealCandidates.push(d)
                byStageActual[fallbackStage].push(d)
                monthRowsWeakCurrentStage++
                dbg(`${dealId} | ${displayRaw} | weak_current_stage=${fallbackStage}`)
                continue
              }

              // Fallback: nieuwe deal zonder history in deze maand naar eerste zichtbare kolom.
              if (!hasHistory && createdMonth === value && fallbackStage === 'lead_gekwalificeerd') {
                dbg(`${dealId} | ${displayRaw} | strict_fallback=discovery_voorgesteld(created_at)`)
                fallbackAsFirstVisible = true
              } else {
                monthRowsUnknownStage++
                dbg(
                  `${dealId} | ${displayRaw} | unplaced(hasHistory=${hasHistory ? 'yes' : 'no'},createdMonth=${createdMonth ?? '-'},fallbackStage=${fallbackStage ?? '-'})`,
                )
                if (debugEnabled) {
                  console.warn('[deals:unplaced-row]', {
                    month: value,
                    dealId,
                    display: displayRaw,
                    hasHistory,
                    createdMonth,
                    fallbackStage,
                    currentPhase: (d.current_phase as Record<string, unknown> | undefined)?.id ?? null,
                    phaseHistoryCount: Array.isArray((d as Record<string, unknown>).phase_history)
                      ? ((d as Record<string, unknown>).phase_history as unknown[]).length
                      : 0,
                  })
                }
                continue
              }
            }

            // 2) Filter oude klanten uit.
            const oldCheck = isOldCustomer(d)
            if (oldCheck.old) {
              dbg(`${dealId} | ${displayRaw} | skipped_old_customer source=${oldCheck.source} value=${oldCheck.value}`)
              continue
            }
            rowDealCandidates.push(d)

            // 3) Plaats deal in juiste kolom(men).
            if (fallbackAsFirstVisible) {
              byStageActual.discovery_voorgesteld.push(d)
              monthRowsFallbackPlaced++
            } else {
              for (const st of reached) {
                if (byStageActual[st]) byStageActual[st].push(d)
              }
            }
            continue
          }

          // In "alle" modus blijft de oud/nieuw-filter actief.
          const oldCheckAll = isOldCustomer(d)
          if (oldCheckAll.old) {
            dbg(`${dealId} | ${displayRaw} | skipped_old_customer(all) source=${oldCheckAll.source} value=${oldCheckAll.value}`)
            continue
          }
          rowDealCandidates.push(d)
          // In "alle" modus gebruiken we de huidige stage.
          const stage = getDealPipelineStage(d)
          dbg(`${dealId} | ${displayRaw} | all_mode_stage=${stage ?? '-'}`)
          if (stage && byStageActual[stage]) {
            byStageActual[stage].push(d)
          }
        }

        // Bouw lookup: company-id -> bedrijfsnaam.
        const companyNameById: Record<string, string> = {}
        for (const c of companies) {
          const anyCompany = c as Record<string, unknown>

          const rawId =
            c.id ??
            (anyCompany.id as string | undefined) ??
            ((anyCompany.company as Record<string, unknown> | undefined)?.id as
              | string
              | undefined) ??
            (anyCompany.company_id as string | undefined)

          const rawName =
            c.name ??
            (anyCompany.name as string | undefined) ??
            (anyCompany.legal_name as string | undefined) ??
            (anyCompany.company_name as string | undefined) ??
            ((anyCompany.company as Record<string, unknown> | undefined)?.name as
              | string
              | undefined)

          if (rawId && rawName) {
            companyNameById[String(rawId)] = String(rawName)
          }
        }

        // Bouw lookup: contact-id -> bedrijfsnaam.
        const contactCompanyNameById: Record<string, string> = {}
        for (const c of contacts) {
          const anyContact = c as Record<string, unknown>
          const rawId = c.id ?? (anyContact.id as string | undefined)
          const rawCompanyName =
            c.company?.name ??
            (anyContact.company_name as string | undefined) ??
            ((anyContact.company as Record<string, unknown> | undefined)?.name as
              | string
              | undefined)

          if (rawId && rawCompanyName) {
            contactCompanyNameById[String(rawId)] = String(rawCompanyName)
          }
        }

        const displayNameOf = (d: DealRow) => dealDisplayName(d, companyNameById, contactCompanyNameById)

        // Pas per kolom dedup, filtering en sortering toe.
        for (const { id } of DEALS_OFFERTES_STAGES) {
          const raw = byStageActual[id] ?? []
          const seenDealIds = new Set<string>()
          let dedupDropped = 0
          const deduped = raw.filter((d) => {
            const dealId = String((d as Record<string, unknown>).id ?? '')
            if (!dealId || seenDealIds.has(dealId)) {
              dedupDropped++
              return false
            }
            seenDealIds.add(dealId)
            return true
          })
          const filtered = deduped.filter((d) => matchesFilters(d, displayNameOf(d)))
          dbg(
            `stage=${id} raw=${raw.length} deduped=${deduped.length} filtered=${filtered.length} dedup_dropped=${dedupDropped}`,
          )
          byStageActual[id] = sortDeals(filtered, displayNameOf)
        }
        dbg(
          `month_checks without_stage=${monthRowsWithoutStage} fallback_placed=${monthRowsFallbackPlaced} unknown_stage=${monthRowsUnknownStage} weak_current_stage=${monthRowsWeakCurrentStage}`,
        )
        if (debugEnabled && value !== 'all' && monthRowsUnknownStage > 0) {
          console.warn('[deals:month-checks]', {
            month: value,
            withoutStage: monthRowsWithoutStage,
            fallbackPlaced: monthRowsFallbackPlaced,
            unknownStage: monthRowsUnknownStage,
            weakCurrentStage: monthRowsWeakCurrentStage,
          })
        }

        const counts = Object.fromEntries(
          DEALS_OFFERTES_STAGES.map(({ id }) => [id, (byStageActual[id] ?? []).length]),
        ) as Record<string, number>

        const stageIndexById = Object.fromEntries(
          DEALS_OFFERTES_STAGES.map(({ id }, i) => [id, i]),
        ) as Record<string, number>

        const monthDealsById = new Map<string, DealRow>()
        for (const { id } of DEALS_OFFERTES_STAGES) {
          for (const d of byStageActual[id] ?? []) {
            const dealId = String((d as Record<string, unknown>).id ?? '')
            if (dealId && !monthDealsById.has(dealId)) monthDealsById.set(dealId, d)
          }
        }

        // Funnel-telling voor conversie: cumulatief t/m hoogste stap bereikt in deze maand (zoals Overzicht).
        const funnelCounts = Object.fromEntries(
          DEALS_OFFERTES_STAGES.map(({ id }) => [id, 0]),
        ) as Record<string, number>
        for (const deal of monthDealsById.values()) {
          const dealId = String((deal as Record<string, unknown>).id ?? '')
          let maxIdx = -1
          if (value === 'all') {
            const cur = getDealPipelineStage(deal)
            if (cur) maxIdx = stageIndexById[cur] ?? -1
          } else {
            for (const st of stagesReachedInMonth(deal, value)) {
              const idx = stageIndexById[st]
              if (idx != null && idx > maxIdx) maxIdx = idx
            }
            // Zichtbaar in een kolom = minstens die stap (ook bij API-fallback zonder reached-set).
            for (const { id } of DEALS_OFFERTES_STAGES) {
              const idx = stageIndexById[id]
              if (idx == null || idx <= maxIdx) continue
              const inCol = (byStageActual[id] ?? []).some(
                (d) => String((d as Record<string, unknown>).id ?? '') === dealId,
              )
              if (inCol) maxIdx = idx
            }
          }
          if (maxIdx < 0) continue
          for (let i = 0; i <= maxIdx; i++) {
            const sid = DEALS_OFFERTES_STAGES[i]?.id
            if (sid) funnelCounts[sid] = (funnelCounts[sid] ?? 0) + 1
          }
        }

        // Elke kolom is een eigen lijst; rijen alignen alleen visueel.
        const maxRows = Math.max(
          1,
          ...DEALS_OFFERTES_STAGES.map(({ id }) => (byStageActual[id] ?? []).length),
        )

        // Conversie in doelkolom = funnel(subtotaal stap) / funnel(vorige stap); subtotaal-rij blijft kolomlijst.
        const conversionPct = (toStage: string, fromStage: string): number | null => {
          const num = funnelCounts[toStage] ?? 0
          const den = funnelCounts[fromStage] ?? 0
          if (den <= 0) return num > 0 ? null : 0
          return Math.round((num / den) * 100)
        }
        const stageConversionRules: Array<{
          stageId: string
          fromStage: string
          kind: 'conversie' | 'succesratio'
        }> = [
          { stageId: 'discovery_voorgesteld', fromStage: 'leads_appointment_setting_selah', kind: 'conversie' },
          { stageId: 'discovery_gepland', fromStage: 'discovery_voorgesteld', kind: 'conversie' },
          { stageId: 'discovery_plaatsgevonden', fromStage: 'discovery_gepland', kind: 'conversie' },
          { stageId: 'offerte_verzonden', fromStage: 'discovery_plaatsgevonden', kind: 'conversie' },
          { stageId: 'offerte_aanvaard', fromStage: 'offerte_verzonden', kind: 'succesratio' },
        ]
        const metricByStage = Object.fromEntries(
          stageConversionRules.map(({ stageId, fromStage, kind }) => [
            stageId,
            {
              kind,
              value: conversionPct(stageId, fromStage),
            },
          ]),
        ) as Record<string, { kind: 'conversie' | 'succesratio'; value: number | null }>
        const headerMetricForStage = (stageId: string) => metricByStage[stageId] ?? null

        return (
          <section key={value} className="deals-excel-month">
            <h3 className="deals-excel-month-title">{label}</h3>
            {debugEnabled ? (
              <details style={{ marginBottom: '0.8rem' }}>
                <summary style={{ cursor: 'pointer' }}>Debug output (kopieer dit)</summary>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    padding: '0.75rem',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.15)',
                    maxHeight: 260,
                    overflow: 'auto',
                    marginTop: '0.5rem',
                  }}
                >
                  {debugLines.join('\n')}
                </pre>
              </details>
            ) : null}
            <table className="deals-excel-table">
              <thead>
                <tr>
                  {DEALS_OFFERTES_STAGES.map(({ id, label: stageLabel }) => (
                    <th key={id}>
                      <span className="deals-excel-th-title">{stageLabel}</span>
                    </th>
                  ))}
                </tr>
                <tr className="deals-excel-th-metrics">
                  {DEALS_OFFERTES_STAGES.map(({ id }) => {
                    const metric = headerMetricForStage(id)
                    if (!metric) return <th key={id} />
                    const label = metric.kind === 'conversie' ? 'Conversie' : 'Succesratio'
                    return (
                      <th
                        key={id}
                        className={
                          metric.kind === 'conversie'
                            ? 'deals-excel-th-metric-conversie'
                            : 'deals-excel-th-metric-succesratio'
                        }
                      >
                        {label}: {metric.value == null ? 'n.v.t.' : `${metric.value}%`}
                      </th>
                    )
                  })}
                </tr>
                <tr>
                  {DEALS_OFFERTES_STAGES.map(({ id }) => (
                    <th key={id} className="deals-excel-th-sub">
                      Klant
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, rowIndex) => (
                  <tr key={rowIndex}>
                    {DEALS_OFFERTES_STAGES.map(({ id }, colIndex) => {
                      const deal = (byStageActual[id] ?? [])[rowIndex]
                      if (!deal) return <td key={id} />

                      const displayName = displayNameOf(deal)
                      const stage = getDealPipelineStage(deal)
                      const stale = isStaleOffer(deal)
                      const ownerName = deal.responsible_user_id ? (userNameById[String(deal.responsible_user_id)] ?? String(deal.responsible_user_id)) : ''

                      return (
                        <td
                          key={id}
                          className={stale ? 'deals-excel-cell-stale' : ''}
                        >
                          <button
                            type="button"
                            className="deals-excel-cell-btn"
                            onClick={() => setSelectedDeal(deal)}
                            title={[
                              displayName ? `${rowIndex + 1}. ${displayName}` : '',
                              deal.title ? `Deal: ${String(deal.title)}` : '',
                              ownerName ? `Owner: ${ownerName}` : '',
                              stage ? `Fase: ${stage}` : '',
                              'Deze stap in deze kolom',
                              `Kolom: ${String(DEALS_OFFERTES_STAGES[colIndex]?.label ?? id)}`,
                              stale ? 'Let op: ≥3 maanden in fase offerte verzonden' : '',
                            ].filter(Boolean).join('\n')}
                          >
                            {displayName ? `${rowIndex + 1}. ${displayName}` : ''}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="deals-excel-subtotaal">
                  {DEALS_OFFERTES_STAGES.map(({ id }) => {
                    const subtotal = counts[id] ?? 0
                    const target = stageTargetById[id] ?? 0
                    const tone =
                      target > 0
                        ? (subtotal >= target ? 'deals-excel-subtotaal-cell-good' : 'deals-excel-subtotaal-cell-bad')
                        : 'deals-excel-subtotaal-cell-neutral'
                    return (
                      <td key={id} className={tone}>
                        Subtotaal: {subtotal}{target > 0 ? ` / ${target}` : ''}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </section>
        )
      })}

      {selectedDeal ? (() => {
        const snap = (selectedDeal as Record<string, unknown>).__manual === true
        const snapStageId = String((selectedDeal as Record<string, unknown>).__manualStage ?? '')
        const snapStageLabel =
          DEALS_OFFERTES_STAGES.find((s) => s.id === snapStageId)?.label ?? (snapStageId || '—')
        const faseLabel = snap ? snapStageLabel : (getDealPipelineStage(selectedDeal) ?? '—')
        return (
        <div className="deals-excel-drawer-backdrop" role="presentation" onClick={() => setSelectedDeal(null)}>
          <aside className="deals-excel-drawer" role="dialog" aria-label="Deal details" onClick={(e) => e.stopPropagation()}>
            <div className="deals-excel-drawer-header">
              <div className="deals-excel-drawer-title">
                <strong>{String(selectedDeal.company_name ?? selectedDeal.title ?? 'Deal')}</strong>
                {!snap && selectedDeal.status ? (
                  <span className="deals-excel-drawer-sub">{String(selectedDeal.status)}</span>
                ) : null}
              </div>
              <button type="button" className="deals-excel-btn" onClick={() => setSelectedDeal(null)}>Sluiten</button>
            </div>
            <div className="deals-excel-drawer-body">
              <div className="deals-excel-detail-grid">
                <div>
                  <span className="deals-excel-detail-k">Klant</span>
                  <span className="deals-excel-detail-v">{String(selectedDeal.company_name ?? selectedDeal.title ?? '—')}</span>
                </div>
                <div>
                  <span className="deals-excel-detail-k">Fase</span>
                  <span className="deals-excel-detail-v">{faseLabel}</span>
                </div>
                {!snap ? (
                  <>
                    <div>
                      <span className="deals-excel-detail-k">Owner</span>
                      <span className="deals-excel-detail-v">
                        {selectedDeal.responsible_user_id ? (userNameById[String(selectedDeal.responsible_user_id)] ?? String(selectedDeal.responsible_user_id)) : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="deals-excel-detail-k">Aangemaakt</span>
                      <span className="deals-excel-detail-v">{String(selectedDeal.created_at ?? '—')}</span>
                    </div>
                    <div>
                      <span className="deals-excel-detail-k">Laatst bijgewerkt</span>
                      <span className="deals-excel-detail-v">{String((selectedDeal as Record<string, unknown>).updated_at ?? selectedDeal.updated_at ?? '—')}</span>
                    </div>
                    <div>
                      <span className="deals-excel-detail-k">Gesloten op</span>
                      <span className="deals-excel-detail-v">{String((selectedDeal as Record<string, unknown>).closed_at ?? '—')}</span>
                    </div>
                  </>
                ) : null}
              </div>
              {!snap ? (
              <div className="deals-excel-detail-block">
                <strong>Fase historie</strong>
                {Array.isArray((selectedDeal as Record<string, unknown>).phase_history) && (selectedDeal as Record<string, unknown>).phase_history ? (
                  <ul className="deals-excel-timeline">
                    {((selectedDeal as Record<string, unknown>).phase_history as unknown[]).slice().reverse().slice(0, 25).map((x, i) => {
                      const o = x as Record<string, unknown>
                      const phase = (o.phase as Record<string, unknown> | undefined) ?? undefined
                      const name = phase?.name != null ? String(phase.name) : '—'
                      const started = o.started_at != null ? String(o.started_at) : ''
                      return (
                        <li key={i} className="deals-excel-timeline-item">
                          <span className="deals-excel-timeline-title">{name}</span>
                          <span className="deals-excel-timeline-meta">{started}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="pipeline-discovery-empty">Geen `phase_history` beschikbaar voor deze deal.</p>
                )}
              </div>
              ) : null}
            </div>
          </aside>
        </div>
        )
      })() : null}
      {selectedMonths.length === 0 && (
        <p className="pipeline-discovery-empty">Selecteer een periode.</p>
      )}
    </div>
  )
}
