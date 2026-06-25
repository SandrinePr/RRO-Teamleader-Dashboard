/**
 * Startpagina Overzicht: targets (localStorage); maandtabel alleen-lezen.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DealRow } from './api'
import { overviewMonthMapFromDeals } from './pipelineMonthOverview'
import {
  fetchEnrichedDealsForMonth,
  clearPipelineSession,
} from './pipelineSession'
import {
  getManualOverviewMonth,
  is2024PipelineDataMonth,
  isManualPipelineMonth,
} from './manualPipeline'
import {
  PIPELINE_TARGET_STAGES,
  type PipelineTargetStage,
  type PipelineTargets,
  loadTargetsForYear,
  pctTarget,
  saveTargetsForYear,
} from './pipelineTargets'

const YEARS = [2024, 2025, 2026]
const MONTHS = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December']
const STAGES = PIPELINE_TARGET_STAGES
type StageName = PipelineTargetStage
type MonthMap = Record<StageName, number>
/** `null` = geen data (bijv. 2024 jan–okt). */
type YearData = Record<string, MonthMap | null>

/** Alleen overzichts-tabel per jaar (blijft bij tab-wissel). */
const overviewYearDataCache: Record<number, YearData> = {}
const overviewCacheVersion: Record<number, string> = {}
/** Bump na wijziging handmatige pipeline-data (invalidates browser-sessie-cache). */
const OVERVIEW_DATA_VERSION = 12

/** Invalideer cache bij nieuwe kalendermaand (2026 groeit t/m huidige maand). */
function overviewCacheToken(year: number, now: Date): string {
  const monthCount = year === 2026 ? now.getMonth() + 1 : 12
  return `${OVERVIEW_DATA_VERSION}:${monthCount}`
}

/** Maanden die live uit Teamleader komen (met phase_history via ?month=). */
function apiMonthKeysForYear(year: number, now: Date): string[] {
  if (year !== 2026) return []
  const maxM = now.getMonth() + 1
  const keys: string[] = []
  for (let m = 1; m <= maxM; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`
    if (getManualOverviewMonth(ym)) continue
    if (isManualPipelineMonth(ym)) continue
    keys.push(ym)
  }
  return keys
}

async function refreshApiMonthsInYearData(
  base: YearData,
  year: number,
  now: Date,
): Promise<YearData> {
  const out = { ...base }
  for (const ym of apiMonthKeysForYear(year, now)) {
    const deals = await fetchEnrichedDealsForMonth(ym)
    out[ym] = overviewMonthMapFromDeals(deals, ym)
  }
  return out
}

function emptyMonthMap(): MonthMap {
  return {
    'Leads Appointment Setting Selah': 0,
    'Discovery call voorgesteld': 0,
    'Discovery call ingepland': 0,
    'Discovery call plaatsgevonden': 0,
    'Offerte verzonden': 0,
    'Offerte geaccepteerd': 0,
  }
}

function buildManualYearOverviewData(year: number, now: Date): YearData {
  return buildYearOverviewData([], year, now)
}

function buildYearOverviewData(allDeals: DealRow[], year: number, now: Date): YearData {
  const maxM = year === 2026 ? now.getMonth() + 1 : 12
  const out: YearData = {}
  for (let m = 1; m <= maxM; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`
    if (year === 2024) {
      out[ym] = is2024PipelineDataMonth(ym) ? getManualOverviewMonth(ym) : null
      continue
    }
    if (year === 2025) {
      out[ym] = getManualOverviewMonth(ym)
      continue
    }
    const manual = getManualOverviewMonth(ym)
    if (manual) {
      out[ym] = manual
      continue
    }
    if (isManualPipelineMonth(ym)) {
      out[ym] = null
      continue
    }
    out[ym] = overviewMonthMapFromDeals(allDeals, ym)
  }
  return out
}

export function Overview() {
  const navigate = useNavigate()
  const nowRef = useRef(new Date())
  const now = nowRef.current
  const initialYear = Math.min(2026, Math.max(2024, now.getFullYear()))
  const [year, setYear] = useState<number>(initialYear)
  /** Pipeline per maand: alleen uit API (read-only in UI). */
  const [data, setData] = useState<YearData>(() => {
    const cached = overviewYearDataCache[initialYear]
    if (cached && overviewCacheVersion[initialYear] === overviewCacheToken(initialYear, now)) {
      return cached
    }
    return buildManualYearOverviewData(initialYear, now)
  })
  const [targets, setTargets] = useState<PipelineTargets>(() => loadTargetsForYear(initialYear))
  const [loading, setLoading] = useState(false)
  /** Voortgang: zware API-call per maand; Strict Mode mag de lus niet afbreken na maand 1. */
  const [loadingProgress, setLoadingProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Geen harde fout bij ontbrekende token — alleen korte hint. */
  const [fetchHint, setFetchHint] = useState<string | null>(null)
  /** Oplopend bij elke load; voorkomt dat Strict Mode cleanup de maandlus afbreekt. */
  const overviewLoadSeq = useRef(0)

  /** 2024: alleen okt/nov/dec in de tabel; andere jaren alle maanden t/m huidige maand (2026). */
  const visibleMonthIndices = useMemo(() => {
    if (year === 2024) return [9, 10, 11]
    const count = year === 2026 ? now.getMonth() + 1 : 12
    return Array.from({ length: count }, (_, i) => i)
  }, [year, now])

  const rows = useMemo(() => {
    return visibleMonthIndices.map((i) => {
      const maand = MONTHS[i]!
      const key = `${year}-${String(i + 1).padStart(2, '0')}`
      return {
        key,
        jaar: year,
        maand,
        values: data[key] ?? null,
      }
    })
  }, [data, year, visibleMonthIndices])

  const totals = useMemo(() => {
    const sum = emptyMonthMap()
    for (const row of rows) {
      if (!row.values) continue
      for (const s of STAGES) sum[s] += Number(row.values[s] ?? 0)
    }
    return sum
  }, [rows])

  const successRatios = useMemo(() => {
    return {
      voorgesteld: pctTarget(totals['Discovery call voorgesteld'], totals['Leads Appointment Setting Selah']),
      ingepland: pctTarget(totals['Discovery call ingepland'], totals['Discovery call voorgesteld']),
      plaatsgevonden: pctTarget(totals['Discovery call plaatsgevonden'], totals['Discovery call ingepland']),
      verzonden: pctTarget(totals['Offerte verzonden'], totals['Discovery call plaatsgevonden']),
      geaccepteerd: pctTarget(totals['Offerte geaccepteerd'], totals['Offerte verzonden']),
    }
  }, [totals])

  // Vul de "Jaar x Maand" tabel (read-only); targets uit localStorage.
  useEffect(() => {
    const seq = ++overviewLoadSeq.current
    const cacheToken = overviewCacheToken(year, now)
    const cached = overviewYearDataCache[year]
    const cacheHit = Boolean(cached && overviewCacheVersion[year] === cacheToken)

    setLoading(true)
    setLoadingProgress(null)
    setFetchHint(null)
    if (!cacheHit) {
      setData(buildManualYearOverviewData(year, now))
    }

    ;(async () => {
      try {
        if (overviewLoadSeq.current !== seq) return

        const apiMonths = apiMonthKeysForYear(year, now)
        if (apiMonths.length > 0) {
          setLoadingProgress(`Teamleader: ${apiMonths.join(', ')} ophalen (met fase-historie)…`)
        }
        if (overviewLoadSeq.current !== seq) return

        const base = cacheHit ? { ...cached! } : buildManualYearOverviewData(year, now)
        const yearData = apiMonths.length > 0
          ? await refreshApiMonthsInYearData(base, year, now)
          : base
        if (overviewLoadSeq.current !== seq) return

        overviewYearDataCache[year] = yearData
        overviewCacheVersion[year] = cacheToken
        setData(yearData)

        if (overviewLoadSeq.current !== seq) return
        setError(null)
        setFetchHint(null)
      } catch (e) {
        if (overviewLoadSeq.current !== seq) return
        const msg = e instanceof Error ? e.message : 'Ophalen mislukt'
        const isAuth =
          /geen token|auth\/login|token verlopen|unauthorized|401/i.test(msg)
        const partial = buildManualYearOverviewData(year, now)
        setData(partial)
        overviewYearDataCache[year] = partial
        overviewCacheVersion[year] = cacheToken
        if (isAuth) {
          clearPipelineSession()
          const apiBase =
            (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL) ||
            window.location.origin
          setError(null)
          setFetchHint(
            `Live pipeline-cijfers (vanaf juni 2026) laden na inloggen bij Teamleader: open ${apiBase}/auth/login. Controle: ${apiBase}/auth/info`,
          )
        } else {
          setError(msg)
          setFetchHint(null)
        }
      } finally {
        if (overviewLoadSeq.current === seq) {
          setLoadingProgress(null)
          setLoading(false)
        }
      }
    })()

    return () => {
      overviewLoadSeq.current++
    }
  }, [year])

  useEffect(() => {
    setTargets(loadTargetsForYear(year))
  }, [year])

  function setTarget(stage: StageName, value: number) {
    const next: PipelineTargets = {
      ...targets,
      [stage]: Number.isFinite(value) ? Math.max(0, value) : 0,
    }
    setTargets(next)
    saveTargetsForYear(year, next)
  }

  return (
    <div className="dashboard rro-overview">
      <div className="rro-tabs">
        <button className="rro-tab rro-tab-active" type="button" onClick={() => navigate('/')}>Overzicht</button>
        <button className="rro-tab" type="button" onClick={() => navigate('/deals')}>Deals en offertes</button>
        <button className="rro-tab" type="button" onClick={() => navigate('/sales-activity')}>Sales activiteit</button>
      </div>

      <label className="rro-year">
        Jaar:
        <select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </label>

      {loading && (
        <p className="pipeline-discovery-empty">
          Bezig met ophalen…{loadingProgress ? ` ${loadingProgress}` : ''}
        </p>
      )}
      {error && <p className="dashboard-error">{error}</p>}
      {fetchHint && !error && <p className="pipeline-discovery-empty">{fetchHint}</p>}

      <div className="overview-table-wrap rro-table-wrap">
        <table className="overview-table rro-table">
          <thead>
            <tr>
              <th>Doelstelling per maand</th>
              {STAGES.map((s) => <th key={s}>{s}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>{year}</strong></td>
              {STAGES.map((s) => (
                <td key={s}>
                  <input
                    className="rro-input"
                    type="number"
                    min={0}
                    value={String(targets[s])}
                    onChange={(e) => setTarget(s, Number(e.target.value || 0))}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td>Succesratio's</td>
              <td />
              <td>{pctTarget(targets['Discovery call voorgesteld'], targets['Leads Appointment Setting Selah'])}</td>
              <td>{pctTarget(targets['Discovery call ingepland'], targets['Discovery call voorgesteld'])}</td>
              <td>{pctTarget(targets['Discovery call plaatsgevonden'], targets['Discovery call ingepland'])}</td>
              <td>{pctTarget(targets['Offerte verzonden'], targets['Discovery call plaatsgevonden'])}</td>
              <td>{pctTarget(targets['Offerte geaccepteerd'], targets['Offerte verzonden'])}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overview-table-wrap rro-table-wrap">
        <table className="overview-table rro-table">
          <thead>
            <tr>
              <th>Jaar</th>
              <th>Maand</th>
              {STAGES.map((s) => <th key={s}>{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="overview-year-cell">{row.jaar}</td>
                <td>{row.maand}</td>
                {STAGES.map((s) => {
                  const raw = row.values?.[s]
                  const hasData = row.values != null && raw != null
                  const value = hasData ? Number(raw) : 0
                  const target = Number(targets[s] ?? 0)
                  const klass =
                    hasData && target > 0
                      ? (value >= target ? 'overview-cell-good' : 'overview-cell-bad')
                      : ''
                  return (
                    <td
                      key={s}
                      className={`${klass} overview-readonly-num`.trim()}
                      title="Alleen-lezen"
                    >
                      {hasData ? value : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="overview-year-row">
              <td colSpan={2}>Totaal</td>
              {STAGES.map((s) => <td key={s}>{totals[s]}</td>)}
            </tr>
            <tr>
              <td colSpan={2}>Succesratio's</td>
              <td />
              <td>{successRatios.voorgesteld}</td>
              <td>{successRatios.ingepland}</td>
              <td>{successRatios.plaatsgevonden}</td>
              <td>{successRatios.verzonden}</td>
              <td>{successRatios.geaccepteerd}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

