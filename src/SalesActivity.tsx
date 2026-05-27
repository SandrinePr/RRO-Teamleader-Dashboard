/** Sales-activiteit: Outlook-e-mails (MS365) per medewerker en maand. */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { apiGetAllowFail } from './api'

type ManualMonth = {
  target: number
}

type ManualStore = Record<string, Record<string, ManualMonth>>

const STORAGE = 'rro_sales_activity_manual_v1'
const MONTH_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

function nowMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function emptyManual(): ManualMonth {
  return { target: 0 }
}

function loadStore(): ManualStore {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return {}
    return JSON.parse(raw) as ManualStore
  } catch {
    return {}
  }
}

function saveStore(store: ManualStore) {
  localStorage.setItem(STORAGE, JSON.stringify(store))
}

/** Alle datums (`yyyy-MM-dd`) in de gekozen maand. */
function eachCalendarDateOfMonth(ym: string): string[] {
  const parts = ym.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  if (!y || !m || m < 1 || m > 12) return []
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => {
    const d = i + 1
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })
}

/** True voor maandag t/m vrijdag. */
function isWeekdayYmd(ymd: string): boolean {
  const parts = ymd.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const d = parts[2]
  if (!y || !mo || !d) return false
  const wd = new Date(y, mo - 1, d).getDay()
  return wd >= 1 && wd <= 5
}

function weekdayDatesInMonth(ym: string): string[] {
  return eachCalendarDateOfMonth(ym).filter(isWeekdayYmd)
}

type PersonOption = { value: string; label: string; mailAliases: string[] }

function personNormKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function personIdentityKey(raw: string): string {
  const t = raw.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  const beforePipe = (t.split(/\s*\|\s*/)[0] ?? t).trim()
  return personNormKey(beforePipe)
}

function displayNameScore(s: string): number {
  const t = s.trim()
  let sc = 0
  if (t.includes('|')) sc += 500
  if (/red\s+rock/i.test(t)) sc += 200
  sc += Math.min(t.length, 200)
  return sc
}

function pickBetterDisplayName(current: string, incoming: string): string {
  return displayNameScore(incoming) > displayNameScore(current) ? incoming : current
}

function normEmail(e: string): string {
  return e.trim().toLowerCase()
}

function isLikelyEmail(s: string): boolean {
  const t = s.trim()
  return t.includes('@') && !t.includes('|')
}

function mergeMonth(a: ManualMonth, b: ManualMonth): ManualMonth {
  return { target: Math.max(a.target, Number(b.target ?? 0)) }
}

function samePersonLoose(storeKey: string, selectedPerson: string): boolean {
  const a = personIdentityKey(storeKey)
  const b = personIdentityKey(selectedPerson)
  if (!a || !b) return false
  if (a === b) return true
  return b.startsWith(a + ' ') || a.startsWith(b + ' ')
}

function storeKeyBelongsToPerson(storeKey: string, person: string, mailAliases: string[]): boolean {
  const sk = storeKey.trim()
  const mails = new Set(mailAliases.map(normEmail).filter(Boolean))
  if (mails.size > 0 && mails.has(normEmail(sk))) return true
  if (personNormKey(sk) === personNormKey(person)) return true
  if (personIdentityKey(sk) === personIdentityKey(person)) return true
  return samePersonLoose(sk, person)
}

function mergedMonthsForPerson(
  store: ManualStore,
  person: string,
  mailAliases: string[],
): Record<string, ManualMonth> {
  const out: Record<string, ManualMonth> = {}
  for (const [storeKey, months] of Object.entries(store)) {
    if (!storeKeyBelongsToPerson(storeKey, person, mailAliases)) continue
    for (const [ym, row] of Object.entries(months)) {
      const prev = out[ym] ?? emptyManual()
      const legacy = row as ManualMonth & Record<string, unknown>
      out[ym] = mergeMonth(prev, { target: Number(legacy.target ?? 0) })
    }
  }
  return out
}

function preferredTargetForPerson(months: Record<string, ManualMonth>): number {
  const ordered = Object.entries(months).sort(([a], [b]) => a.localeCompare(b))
  for (let i = ordered.length - 1; i >= 0; i--) {
    const target = Number(ordered[i]?.[1]?.target ?? 0)
    if (target > 0) return target
  }
  return 0
}

export function SalesActivity() {
  const navigate = useNavigate()
  const [person, setPerson] = useState<string>('Lars')
  const [personOptions, setPersonOptions] = useState<PersonOption[]>([
    { value: 'Lars', label: 'Lars', mailAliases: [] },
  ])
  const [personsLoading, setPersonsLoading] = useState(true)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [period, setPeriod] = useState<string>(nowMonth())
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [store, setStore] = useState<ManualStore>(() => loadStore())
  const [msSentEmailCount, setMsSentEmailCount] = useState<number | null>(null)
  const [emailByDay, setEmailByDay] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setPersonsLoading(true)
      type IdentityRow = { display: string; mails: Set<string> }
      const byIdentity = new Map<string, IdentityRow>()

      function addPerson(label: string, mail?: string) {
        const t = label.trim()
        if (!t) return
        const id = personIdentityKey(t)
        if (!id) return
        let row = byIdentity.get(id)
        if (!row) {
          row = { display: t, mails: new Set<string>() }
          byIdentity.set(id, row)
        }
        row.display = pickBetterDisplayName(row.display, t)
        if (mail) row.mails.add(normEmail(mail))
      }

      type Ms365Users = { data?: Array<{ displayName?: string; mail?: string }> }
      const ms = await apiGetAllowFail<Ms365Users>('/ms365/users')
      if (!cancelled && ms?.data?.length) {
        for (const u of ms.data) {
          const dn = (u.displayName ?? '').trim()
          const mail = typeof u.mail === 'string' ? u.mail : ''
          if (dn) addPerson(dn, mail)
        }
      }

      type TlUsers = { data?: Array<Record<string, unknown>> }
      const tl = await apiGetAllowFail<TlUsers>('/users')
      if (!cancelled && tl?.data?.length) {
        for (const u of tl.data) {
          const fn = String(u.first_name ?? u.firstName ?? '').trim()
          const ln = String(u.last_name ?? u.lastName ?? '').trim()
          const mail = String(u.email ?? '').trim()
          const n =
            `${fn} ${ln}`.trim() ||
            String(u.name ?? u.display_name ?? u.displayName ?? '').trim() ||
            mail
          if (n) addPerson(n, mail)
        }
      }

      const persisted = loadStore()
      for (const k of Object.keys(persisted)) {
        if (!isLikelyEmail(k)) addPerson(k)
      }

      if (byIdentity.size === 0) addPerson('Lars')

      let opts = [...byIdentity.values()]
        .map((row) => ({
          value: row.display,
          label: row.display,
          mailAliases: [...row.mails],
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'nl', { sensitivity: 'base' }))

      const coveredMails = new Set(opts.flatMap((o) => o.mailAliases.map(normEmail)))
      for (const k of Object.keys(persisted)) {
        if (!isLikelyEmail(k)) continue
        const em = normEmail(k)
        if (coveredMails.has(em)) continue
        opts.push({ value: k, label: k, mailAliases: [em] })
        coveredMails.add(em)
      }

      {
        const seen = new Set<string>()
        opts = opts.filter((o) => {
          const k = personIdentityKey(o.label)
          if (!k || seen.has(k)) return false
          seen.add(k)
          return true
        })
      }

      if (!cancelled) {
        setPersonOptions(opts)
        setPerson((prev) => {
          if (opts.some((o) => o.value === prev)) return prev
          const byId = opts.find((o) => personIdentityKey(o.value) === personIdentityKey(prev))
          if (byId) return byId.value
          const loose = opts.find((o) => samePersonLoose(prev, o.value))
          if (loose) return loose.value
          const prevMail = normEmail(prev)
          if (prevMail && prev.includes('@')) {
            const byMail = opts.find((o) => o.mailAliases.some((m) => normEmail(m) === prevMail))
            if (byMail) return byMail.value
          }
          return opts[0]?.value ?? prev
        })
        setPersonsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const monthTabs = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      return {
        value: `${year}-${String(m).padStart(2, '0')}`,
        label: MONTH_LABELS[i],
      }
    })
  }, [year])

  const mailAliasesForPerson = useMemo(() => {
    return personOptions.find((o) => o.value === person)?.mailAliases ?? []
  }, [personOptions, person])

  useEffect(() => {
    if (period === 'all') {
      setMsSentEmailCount(null)
      setEmailByDay({})
      return
    }
    const mail = mailAliasesForPerson.find((m) => normEmail(m))
    if (!mail) {
      setMsSentEmailCount(null)
      setEmailByDay({})
      return
    }
    let cancelled = false
    setEmailsLoading(true)
    Promise.all([
      apiGetAllowFail<{ count?: number }>(
        `/ms365/emails?user=${encodeURIComponent(mail)}&period=${encodeURIComponent(period)}`,
      ),
      apiGetAllowFail<{ days?: Array<{ date?: string; count?: number }> }>(
        `/ms365/emails/daily?user=${encodeURIComponent(mail)}&period=${encodeURIComponent(period)}`,
      ),
    ])
      .then(([countRes, dailyRes]) => {
        if (cancelled) return
        setMsSentEmailCount(typeof countRes?.count === 'number' ? countRes.count : null)
        const map: Record<string, number> = {}
        for (const d of dailyRes?.days ?? []) {
          const key = d?.date?.trim()
          if (key) map[key] = Number(d?.count ?? 0)
        }
        setEmailByDay(map)
      })
      .finally(() => {
        if (!cancelled) setEmailsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, mailAliasesForPerson])

  const manual = useMemo(() => {
    const byPerson = mergedMonthsForPerson(store, person, mailAliasesForPerson)
    const preferredTarget = preferredTargetForPerson(byPerson)
    if (period === 'all') {
      return { target: preferredTarget }
    }
    return byPerson[period] ?? { ...emptyManual(), target: preferredTarget }
  }, [store, person, period, mailAliasesForPerson])

  function updateTarget(value: number) {
    const key = period === 'all' ? nowMonth() : period
    const base = mergedMonthsForPerson(store, person, mailAliasesForPerson)
    const next: ManualStore = { ...store }
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0)
    for (const k of Object.keys(next)) {
      if (k === person) continue
      if (storeKeyBelongsToPerson(k, person, mailAliasesForPerson)) delete next[k]
    }
    const personMonths: Record<string, ManualMonth> = { ...base }
    for (const ym of Object.keys(personMonths)) {
      personMonths[ym] = { target: safeValue }
    }
    personMonths[key] = { target: safeValue }
    next[person] = personMonths
    setStore(next)
    saveStore(next)
  }

  const emailsSent = period === 'all' ? 0 : (msSentEmailCount ?? 0)
  const hasTarget = manual.target > 0
  const reached = hasTarget && emailsSent >= manual.target
  const progressPct = hasTarget
    ? Math.min(100, Math.round((emailsSent / manual.target) * 100))
    : 0
  const progressHue =
    !hasTarget
      ? 210
      : progressPct < 50
        ? 0
        : progressPct < 75
          ? 28
          : Math.round(28 + ((progressPct - 75) / 25) * (120 - 28))
  const progressColor = hasTarget ? `hsl(${progressHue} 78% 47%)` : 'rgba(148, 163, 184, 0.45)'
  const mailConfigured = mailAliasesForPerson.some((m) => normEmail(m))

  const dailyChart = useMemo(() => {
    if (period === 'all') return []
    return weekdayDatesInMonth(period).map((date) => ({
      dag: String(Number(date.slice(8, 10))),
      datum: date,
      emails: emailByDay[date] ?? 0,
    }))
  }, [period, emailByDay])

  const periodTitle = useMemo(() => {
    if (period === 'all') return `Overzicht ${year}`
    const m = Number(period.split('-')[1])
    return `${MONTH_LABELS[m - 1] ?? period} ${year}`
  }, [period, year])

  const emailStats = useMemo(() => {
    if (period === 'all') {
      return { workdays: 0, outsideWorkdays: 0 }
    }
    let outsideWorkdays = 0
    for (const date of eachCalendarDateOfMonth(period)) {
      if (isWeekdayYmd(date)) continue
      outsideWorkdays += emailByDay[date] ?? 0
    }
    return {
      workdays: weekdayDatesInMonth(period).length,
      outsideWorkdays,
    }
  }, [period, emailByDay])

  return (
    <div className="dashboard rro-overview">
      <div className="rro-tabs">
        <button className="rro-tab" type="button" onClick={() => navigate('/')}>Overzicht</button>
        <button className="rro-tab" type="button" onClick={() => navigate('/deals')}>Deals en offertes</button>
        <button className="rro-tab rro-tab-active" type="button" onClick={() => navigate('/sales-activity')}>Sales activiteit</button>
      </div>

      <div className="deals-offertes-toolbar">
        <div className="deals-offertes-controls">
          <label className="pipeline-month-label">
            Jaar:
            <select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="pipeline-month-select">
              {[2024, 2025, 2026].map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </label>
          <div className="deals-offertes-month-tabs" role="tablist" aria-label="Maanden">
            {monthTabs.map((t) => (
              <button key={t.value} type="button" className={`month-tab${period === t.value ? ' month-tab-active' : ''}`} onClick={() => setPeriod(t.value)}>
                {t.label}
              </button>
            ))}
            <button type="button" className={`month-tab${period === 'all' ? ' month-tab-active' : ''}`} onClick={() => setPeriod('all')}>
              Alle
            </button>
          </div>
        </div>
      </div>

      <div className="sales-activity-filter">
        <label>
          Persoon:
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            disabled={personsLoading}
            className="pipeline-month-select"
          >
            {personOptions.map((o) => (
              <option key={personIdentityKey(o.value)} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <section className="sales-activity-summary" aria-label="Samenvatting e-mailactiviteit">
        <div className="sales-activity-summary-card sales-activity-hero">
          <p className="sales-activity-hero-kicker">Outlook · verzonden e-mails</p>
          <p className="sales-activity-hero-value" aria-live="polite">
            {emailsLoading && period !== 'all' ? '…' : emailsSent}
          </p>
          <p className="sales-activity-hero-label">{periodTitle}</p>
          <p className="sales-activity-hero-person">{person}</p>
        </div>

        <div className="sales-activity-summary-card sales-activity-goal-panel">
          <div className="sales-activity-goal-head">
            <h3>Maanddoel</h3>
            <label className="sales-activity-goal-input">
              <span>Doel</span>
              <input
                type="number"
                min={0}
                value={String(manual.target)}
                onChange={(e) => updateTarget(Number(e.target.value || 0))}
              />
            </label>
          </div>
          <div className="sales-activity-progress-track">
            <div
              className="sales-activity-progress-fill"
              style={{ width: hasTarget ? `${progressPct}%` : '0%', background: progressColor }}
            />
          </div>
          <div className="sales-activity-goal-meta">
            <span className={`sales-activity-goal-status ${hasTarget ? (reached ? 'good' : 'pending') : 'unset'}`}>
              {hasTarget ? (
                <>
                  <strong>{emailsSent}</strong> van <strong>{manual.target}</strong> e-mails
                  <span className="sales-activity-goal-pct">({progressPct}%)</span>
                </>
              ) : (
                <>
                  <strong>{emailsSent}</strong> e-mails verstuurd
                  <span className="sales-activity-goal-hint">— stel een doel in om voortgang te volgen</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="sales-activity-side-stats">
          <div className="sales-activity-stat">
            <strong>{period === 'all' ? '—' : emailStats.workdays}</strong>
            <span>Werkdagen in de maand</span>
          </div>
          <div className="sales-activity-stat sales-activity-stat-muted">
            <strong>{period === 'all' ? '—' : emailStats.outsideWorkdays}</strong>
            <span>E-mails buiten werkdagen</span>
          </div>
        </div>
      </section>

      {!mailConfigured && period !== 'all' ? (
        <p className="sales-activity-banner sales-activity-banner-warn">
          Geen Outlook-mailadres gekoppeld aan deze persoon — e-mailcijfers zijn niet beschikbaar.
        </p>
      ) : null}

      <section className="sales-activity-chart">
        <h3>{period === 'all' ? 'E-mails per werkdag' : `E-mails per werkdag · ${periodTitle}`}</h3>
        {period === 'all' ? (
          <p className="sales-activity-note">Kies een specifieke maand om elke werkdag (ma–vr) te zien.</p>
        ) : (
          <>
          <p className="sales-activity-chart-note">
            Alleen werkdagen (ma–vr). E-mails in weekenden tellen mee in het totaal en bij &quot;E-mails buiten werkdagen&quot;, niet in deze grafiek.
          </p>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={dailyChart} margin={{ left: 0, right: 4, top: 4, bottom: 22 }} barCategoryGap="6%">
              <XAxis
                dataKey="dag"
                interval={0}
                tick={{ fontSize: 14, fill: '#e2e8f0' }}
                label={{ value: 'Dag van de maand', position: 'insideBottom', offset: -4, style: { fill: '#e2e8f0', fontSize: 14 } }}
              />
              <YAxis tick={{ fontSize: 14, fill: '#e2e8f0' }} width={34} tickMargin={2} allowDecimals={false} />
              <Tooltip
                labelFormatter={(_, payload) => (payload?.[0]?.payload as { datum?: string } | undefined)?.datum ?? ''}
                contentStyle={{ fontSize: '0.9rem', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8 }}
                labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
              />
              <Bar dataKey="emails" name="E-mails gestuurd" fill="#2fbf71" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </>
        )}
      </section>
    </div>
  )
}
