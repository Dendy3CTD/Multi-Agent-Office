import { useEffect, useMemo, useState, type FormEvent } from "react";
import MAOTower from "./integration/MAOTower";
import { useLiveOfficeData } from './live'
import { createMaoFetchTransport } from './live/transport'
import type { LiveOfficeState } from './live/types'
import AgentTerminal from './terminal/AgentTerminal'

const API = '/mao-api'
function TaskDesk({ liveState }: { liveState: LiveOfficeState }) {
  const { projects, employees, tasks } = liveState
  const [title, setTitle] = useState(''), [brief, setBrief] = useState(''), [projectId, setProjectId] = useState('')
  const [events, setEvents] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [uncertainTitle, setUncertainTitle] = useState('')
  const apiStatus = liveState.dataMode === 'live' || liveState.dataMode === 'stale' ? 'connected' : liveState.dataMode === 'loading' ? 'checking' : 'unavailable'
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id) }, [projectId, projects])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setEvents([])
    try {
      const response=await fetch(`${API}/api/tasks`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({projectId,title,brief}),signal:AbortSignal.timeout(120000)})
      const body=await response.json(); if(!response.ok) throw Error(body.error?.code ?? `HTTP ${response.status}`)
      const id=body.task?.id; setTitle(''); setBrief(''); await liveState.refresh()
      if(id){ void fetch(`${API}/api/tasks/${id}/events`).then(async response=>{const reader=response.body?.getReader();if(!reader)return;const decoder=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const blocks=buffer.split('\n\n');buffer=blocks.pop()??'';for(const block of blocks){const data=block.split('\n').find(line=>line.startsWith('data: '))?.slice(6);if(data)setEvents(items=>[...items,data])}}}).catch(()=>{}) }
    } catch(e){
      if(e instanceof DOMException&&e.name==='TimeoutError'){
        setUncertainTitle(title); setError('Ответ API задержался. Проверяю историю Task Store; не отправляйте эту задачу повторно, пока проверка не завершится.')
        void liveState.refresh().then(()=>setError('Проверьте историю по заголовку перед повторной отправкой.'))
      } else setError(e instanceof Error?e.message:'task_submission_failed')
    } finally{setBusy(false)}
  }
  const verifyBeforeRetry = async () => {
    await liveState.refresh()
    const alreadySaved = tasks.some(task => task.title.trim() === uncertainTitle.trim())
    setError(alreadySaved ? `Задача «${uncertainTitle}» уже есть в истории Task Store. Повтор не отправлен.` : 'В истории задачи с таким заголовком нет. Можно отправить её снова.')
    if (!alreadySaved) setUncertainTitle('')
  }
  return <section className="task-desk" aria-label="Реальные задачи">
    <header><b>MAO HYBRID</b><span>Director · Codex Runtime</span><i data-api-status={apiStatus}>{apiStatus==='connected'?'API connected':apiStatus==='checking'?'Проверка API…':'API offline'}</i><button onClick={()=>void (uncertainTitle ? verifyBeforeRetry() : liveState.refresh())}>{uncertainTitle?'Проверить задачу':'Обновить'}</button></header>
    <form onSubmit={submit}><h2>Новая задача</h2><select aria-label="Проект" value={projectId} onChange={e=>setProjectId(e.target.value)} required><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input aria-label="Заголовок" placeholder="Заголовок" value={title} onChange={e=>setTitle(e.target.value)} required/><textarea aria-label="Описание задачи" placeholder="Что нужно сделать?" value={brief} onChange={e=>setBrief(e.target.value)} required/><button disabled={busy||Boolean(uncertainTitle)||!projectId||apiStatus!=='connected'}>{busy?'Отправка…':uncertainTitle?'Сначала проверьте историю':'Передать Director'}</button>{!projects.length&&<small>Нет зарегистрированных проектов. Чат №1 должен вызвать POST /api/projects с id, name и существующим workspaceRoot.</small>}</form>
    {(error||liveState.error)&&<p role="alert">{error||liveState.error}</p>}<div className="task-history"><h2>История задач · Task Store</h2>{tasks.map(task=><article key={task.id}><b>{task.title}</b><span>{task.status}</span><small>Сотрудник: {employees.find(person=>person.id===task.employeeId)?.name ?? task.employeeId ?? 'Director назначает'}</small>{task.resultSummary&&<pre>{task.resultSummary}</pre>}<small>Отмена: Runtime API не поддерживает</small></article>)}</div>
    <aside><h3>Codex события</h3>{events.map((item,i)=><pre key={i}>{item}</pre>)}</aside>
  </section>
}

function initialFixtureMode(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "fixture";
}

function OfficeApp() {
  const [fixtureMode, setFixtureMode] = useState(initialFixtureMode);
  const transport = useMemo(() => createMaoFetchTransport({ baseUrl: API }), [])
  const liveOptions = useMemo(() => ({ transport: fixtureMode ? undefined : transport, refreshIntervalMs: 15000 }), [fixtureMode, transport])
  const liveState = useLiveOfficeData(liveOptions)
  const toggleMode = () => {
    const next = !fixtureMode;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("mode", "fixture");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setFixtureMode(next);
  };

  return <><MAOTower key={fixtureMode ? "development-fixture" : "live-backend"} fixtureMode={fixtureMode} onToggleFixture={toggleMode} liveState={liveState} />{!fixtureMode&&<TaskDesk liveState={liveState}/>}<a className="office-terminal-link" href="/terminal">Agent Terminal <span aria-hidden="true">↗</span></a></>;
}

export default function App() {
  return window.location.pathname.replace(/\/$/, '') === '/terminal' ? <AgentTerminal /> : <OfficeApp />
}
