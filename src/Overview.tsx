/**
 * Startpagina Overzicht: targets (localStorage); maandtabel alleen-lezen.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type DealRow, getDealPipelineStage } from './api'
import {
  dealTouchesMonth,
  fetchAllPipelineDeals,
  pipelineSession,
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
const overviewCacheVersion: Record<number, number> = {}
/** Bump na wijziging handmatige pipeline-data (invalidates browser-sessie-cache). */
const OVERVIEW_DATA_VERSION = 6

function emptyMonthMap(): MonthMap {
  return {
    'Discovery call voorgesteld': 0,
    'Discovery call ingepland': 0,
    'Discovery call plaatsgevonden': 0,
    'Offerte verzonden': 0,
    'Offerte geaccepteerd': 0,
  }
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
    const monthDeals = allDeals.filter((d) => dealTouchesMonth(d, ym))
    out[ym] = aggregateMonthCounts(monthDeals)
  }
  return out
}

function aggregateMonthCounts(deals: DealRow[]): MonthMap {
  const mm = emptyMonthMap()
  const stageOrderIndex: Record<string, number> = {
    lead_gekwalificeerd: 0,
    discovery_voorgesteld: 1,
    discovery_gepland: 2,
    discovery_plaatsgevonden: 3,
    offerte_verzonden: 4,
    offerte_aanvaard: 5,
    offerte_geweigerd: 6,
  }
  for (const deal of deals) {
    const stage = getDealPipelineStage(deal)
    if (!stage) continue
    const curIdx = stageOrderIndex[stage]
    if (curIdx == null) continue
    if (curIdx >= 1) mm['Discovery call voorgesteld'] += 1
    if (curIdx >= 2) mm['Discovery call ingepland'] += 1
    if (curIdx >= 3) mm['Discovery call plaatsgevonden'] += 1
    if (curIdx >= 4) mm['Offerte verzonden'] += 1
    if (stage === 'offerte_aanvaard') mm['Offerte geaccepteerd'] += 1
  }
  return mm
}

export function Overview() {
  const navigate = useNavigate()
  const nowRef = useRef(new Date())
  const now = nowRef.current
  const initialYear = Math.min(2026, Math.max(2024, now.getFullYear()))
  const [year, setYear] = useState<number>(initialYear)
  /** Pipeline per maand: alleen uit API (read-only in UI). */
  const [data, setData] = useState<YearData>(() => overviewYearDataCache[initialYear] ?? {})
  const [targets, setTargets] = useState<PipelineTargets>(() => loadTargetsForYear(initialYear))
  const [loading, setLoading] = useState(false)
  /** Voortgang: zware API-call per maand; Strict Mode mag de lus niet afbreken na maand 1. */
  const [loadingProgress, setLoadingProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Geen harde fout bij ontbrekende token — alleen korte hint. */
  const [fetchHint, setFetchHint] = useState<string | null>(null)
  /** Oplopend bij elke load; voorkomt dat Strict Mode cleanup de maandlus afbreekt. */
  const overviewLoadSeq = useRef(0)

  /** 2024: alleen nov/dec in de tabel; andere jaren alle maanden t/m huidige maand (2026). */
  const visibleMonthIndices = useMemo(() => {
    if (year === 2024) return [10, 11]
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
      ingepland: pctTarget(totals['Discovery call ingepland'], totals['Discovery call voorgesteld']),
      plaatsgevonden: pctTarget(totals['Discovery call plaatsgevonden'], totals['Discovery call ingepland']),
      verzonden: pctTarget(totals['Offerte verzonden'], totals['Discovery call plaatsgevonden']),
      geaccepteerd: pctTarget(totals['Offerte geaccepteerd'], totals['Offerte verzonden']),
    }
  }, [totals])

  // Vul de "Jaar x Maand" tabel (read-only); targets uit localStorage.
  useEffect(() => {
    const seq = ++overviewLoadSeq.current

    // Al eerder geladen voor dit jaar (bijv. terug vanaf Deals en offertes).
    if (overviewYearDataCache[year] && overviewCacheVersion[year] === OVERVIEW_DATA_VERSION) {
      setData(overviewYearDataCache[year])
      setLoading(false)
      setLoadingProgress(null)
      setError(null)
      setFetchHint(null)
      return
    }

    setLoading(true)
    setLoadingProgress(null)
    setFetchHint(null)
    if (!pipelineSession.allDeals) setData({})

    ;(async () => {
      try {
        if (overviewLoadSeq.current !== seq) return

        let allDeals = pipelineSession.allDeals
        if (!allDeals) {
          setLoadingProgress('Teamleader: alle deals ophalen (één keer voor 2024–2026)…')
          allDeals = await fetchAllPipelineDeals()
        } else {
          setLoadingProgress(`${year}: maanden berekenen…`)
        }
        if (overviewLoadSeq.current !== seq) return

        const yearData = buildYearOverviewData(allDeals, year, now)
        overviewYearDataCache[year] = yearData
        overviewCacheVersion[year] = OVERVIEW_DATA_VERSION
        setData(yearData)

        if (overviewLoadSeq.current !== seq) return
        setError(null)
        setFetchHint(null)
      } catch (e) {
        if (overviewLoadSeq.current !== seq) return
        const msg = e instanceof Error ? e.message : 'Ophalen mislukt'
        const isAuth =
          /geen token|auth\/login|token verlopen|unauthorized|401/i.test(msg)
        if (isAuth) {
          clearPipelineSession()
          Object.keys(overviewYearDataCache).forEach((k) => {
            delete overviewYearDataCache[Number(k)]
            delete overviewCacheVersion[Number(k)]
          })
          setError(null)
          setData({})
          const authUrl = `${window.location.origin}/auth/login`
          const infoUrl = `${window.location.origin}/auth/info`
          setFetchHint(
            `Live pipeline-cijfers laden na inloggen bij Teamleader: open ${authUrl}. Controle: ${infoUrl}`,
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

