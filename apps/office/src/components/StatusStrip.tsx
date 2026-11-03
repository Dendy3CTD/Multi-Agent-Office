/**
 * StatusStrip — pipeline health along the bottom of the office: connection
 * (online / reconnecting / offline), when a Claude Code hook last reached the
 * server — or that none has, with the installer command — how many sessions
 * there are, how many of them are not hooked and how many need you, and the
 * server's version. The answer to "nothing appears".
 *
 * The health lives in the office reducer (OfficeState.health: `connection`
 * actions from useAgentSocket, `health` events from server/health.js). The
 * strip samples it once a second — the cadence its "12 s ago" label needs
 * anyway — so nothing else re-renders on its account. The session counts
 * come from the sessions list App.tsx already holds (useAgentSocket), the
 * records the title-bar pills draw, not from the throttled health report.
 * Under ?sim / ?video there is no server: only a SIM badge.
 *
 * When the server showed the page the office read-only (no office token, or
 * a stale one: src/officeToken.ts) an amber item says so and how to get the
 * link that fixes it.
 *
 * VITE_HOOK_WARN_MS (build-time, ms) lowers the 60 s "no hook events yet"
 * threshold, for screenshots and demos.
 */

import React, { useEffect, useState } from 'react'
import { hookVerdict, initialHealth, HOOK_WARN_MS, type HealthState, type HookVerdict, type OfficeState, type ConnectionPhase } from '../officeReducer'
import { needsYouLabel, stripCounts, type StripCounts } from '../mainState'
import type { SessionInfo } from '../types'
import { pillLabel } from './SessionStrip'
import { officeHttpBase } from '../serverUrl'
import '../styles/strip.css'

const params = new URLSearchParams(window.location.search)
const MODE: 'live' | 'sim' | 'video' = params.has('video') ? 'video' : params.has('sim') ? 'sim' : 'live'
const WARN_MS = Number(import.meta.env.VITE_HOOK_WARN_MS) || HOOK_WARN_MS

const SERVER_URL  = officeHttpBase()
const START_CMD   = 'npm run server'
const START_ALT   = 'bash scripts/start-office.sh'
const INSTALL_CMD = 'npm run install-hooks'
const DOCTOR_CMD  = 'npm run doctor'
const OPEN_CMD    = 'npm run open'
const READ_ONLY_HINT = [
  'Только чтение: у страницы нет токена офиса или он устарел, поэтому сервер показывает офис',
  'без промптов, ответов и команд; разрешения подтверждаются в терминале.',
  `Откройте ссылку из запуска сервера или выполните ${OPEN_CMD} в проекте:`,
  'ссылка откроет офис с токеном, который браузер запомнит.',
].join('\n')

const CONNECTION_LABEL: Record<ConnectionPhase, string> = {
  connecting:   'подключение…',
  online:       'в сети',
  reconnecting: 'повторное подключение…',
  offline:      'не в сети',
}

interface StatusStripProps {
  /** The office state as App.tsx holds it (officeRef); sampled, not subscribed */
  office: { readonly current: OfficeState | null }
  /** The sessions App.tsx holds (useAgentSocket): counted, not-hooked and needs-you */
  sessions?: SessionInfo[]
  /** The server sent the office read-only (useAgentSocket's `trusted` is false) */
  readOnly?: boolean
}

/** "just now", "12 s ago", "3 min ago", "2 h ago" */
export function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 2) return 'только что'
  if (s < 60) return `${s} с назад`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн. назад`
}

/** "45 s", "3 min", "2 h 05 min" */
export function formatSpan(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  return `${h} ч ${String(m % 60).padStart(2, '0')} мин`
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** The hooks pill: text and tone */
function hooksPill(v: HookVerdict): { text: string; tone: 'ok' | 'warn' | 'dim' } {
  switch (v.kind) {
    case 'unknown': return { text: 'хуки: —', tone: 'dim' }
    case 'seen':    return { text: `хуки: последнее событие ${formatAgo(v.agoMs)}`, tone: v.agoMs < 10 * 60_000 ? 'ok' : 'dim' }
    case 'waiting': return { text: 'хуки: событий пока нет', tone: 'dim' }
    case 'missing': return { text: `событий хуков нет — запустите ${INSTALL_CMD}`, tone: 'warn' }
  }
}

/** The tooltip: what is going on and what to type */
function describe(h: HealthState, v: HookVerdict, now: number, c: StripCounts): string {
  const s = h.server
  const lines: Array<string | null> = []
  switch (h.connection) {
    case 'online':       lines.push(`Сервер офиса ${SERVER_URL}: в сети с ${clock(h.connectionSince)}`); break
    case 'connecting':   lines.push(`Сервер офиса ${SERVER_URL}: подключение…`); break
    case 'reconnecting': lines.push(`Сервер офиса ${SERVER_URL}: связь потеряна ${formatAgo(now - h.connectionSince)}, повторяю подключение`); break
    case 'offline':      lines.push(`Сервер офиса ${SERVER_URL}: недоступен`); break
  }
  if (h.connection === 'offline' || h.connection === 'reconnecting') {
    lines.push(`Запустите в проекте: ${START_CMD} (или ${START_ALT})`)
  }
  switch (v.kind) {
    case 'seen':    lines.push(`Хуки: событий с запуска сервера — ${v.count}, последнее ${formatAgo(v.agoMs)}`); break
    case 'waiting': lines.push('Хуки: событий пока нет — они срабатывают при вызове инструмента Claude Code'); break
    case 'missing': lines.push(`Хуки: нет событий ${formatSpan(v.forMs)}. Если Claude Code работает, установите хуки: ${INSTALL_CMD}`); break
    case 'unknown': break
  }
  if (s) {
    lines.push(`Сессии: ${s.sessions} · сотрудники: ${s.agents} · клиенты: ${s.clients}`)
    if (c.notHooked.length > 0) {
      lines.push(`Без хуков: ${c.notHooked.map(pillLabel).join(', ')} — запустите ${INSTALL_CMD}`)
    }
    if (c.needYou.length > 0) {
      lines.push('Ожидают вашего внимания:')
      for (const session of c.needYou) {
        if (session.main?.needsYou) lines.push(`  ${pillLabel(session)} — ${needsYouLabel(session.main.needsYou)}`)
      }
    }
    lines.push(`Сервер v${s.version}, работает ${formatSpan(s.uptimeMs + Math.max(0, now - (h.reportedAt ?? now)))} · UI: ${s.uiAvailable ? 'собран (dist/)' : 'dev-сервер (dist/ не собран)'}`)
  }
  lines.push(`Диагностика: ${DOCTOR_CMD}`)
  return lines.filter(Boolean).join('\n')
}

const StatusStrip: React.FC<StatusStripProps> = ({ office, sessions = [], readOnly = false }) => {
  // Sample the reducer's health once a second (also ticks the "ago" labels)
  const [view, setView] = useState(() => ({ health: office.current?.health ?? null, now: Date.now() }))
  useEffect(() => {
    if (MODE !== 'live') return
    const sample = () => setView({ health: office.current?.health ?? null, now: Date.now() })
    const timer = setInterval(sample, 1000)
    return () => clearInterval(timer)
  }, [office])

  if (MODE !== 'live') {
    return (
      <div className="status-badge sim" title={`?${MODE}: локальная демонстрация, без сервера и хуков`} data-mode={MODE}>
        ДЕМОНСТРАЦИЯ
      </div>
    )
  }

  const h = view.health ?? initialHealth(view.now)
  const v = hookVerdict(h, view.now, WARN_MS)
  const pill = hooksPill(v)
  const s = h.server
  const down = h.connection === 'offline' || h.connection === 'reconnecting'
  const c = stripCounts(sessions)

  return (
    <div
      className="status-strip"
      role="status"
      aria-label="Состояние конвейера"
      title={describe(h, v, view.now, c)}
      data-connection={h.connection}
      data-hooks={v.kind}
    >
      <span className="strip-item strip-conn">
        <span className="strip-dot" />
        {CONNECTION_LABEL[h.connection]}
      </span>
      {readOnly && (
        <>
          <span className="strip-sep" />
          <span className="strip-item strip-readonly" title={READ_ONLY_HINT} data-testid="strip-read-only">
            только чтение: откройте ссылку из <code>{OPEN_CMD}</code>
          </span>
        </>
      )}
      <span className="strip-sep" />
      <span className={`strip-item strip-hooks ${pill.tone}`}>{pill.text}</span>
      {s && (
        <>
          <span className="strip-sep" />
          <span className="strip-item strip-sessions">
            {c.sessionsText}
            {c.notHookedText && <><span className="strip-mid">·</span><span className="strip-unhooked">{c.notHookedText}</span></>}
            {c.needYouText && <><span className="strip-mid">·</span><span className="strip-needs-you">{c.needYouText}</span></>}
          </span>
        </>
      )}
      <span className="strip-spacer" />
      {down && <span className="strip-item strip-hint">запустите: <code>{START_CMD}</code></span>}
      {!down && v.kind === 'missing' && <span className="strip-item strip-hint"><code>{DOCTOR_CMD}</code></span>}
      {s && <span className="strip-item strip-version">v{s.version}</span>}
    </div>
  )
}

export default StatusStrip
