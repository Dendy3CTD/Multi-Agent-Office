export type SceneStatus = 'loading' | 'ready' | 'error'

/** Covers the canvas until its renderer reports a successful, complete frame. */
export default function SceneStatusOverlay({ status, onRetry }: { status: SceneStatus; onRetry: () => void }) {
  if (status === 'ready') return null
  return <div className="mao-scene-status" data-scene-status={status} role={status === 'error' ? 'alert' : 'status'} aria-live="polite" aria-busy={status === 'loading'}>
    <div><span className="mao-eyebrow">MULTI-AGENT OFFICE</span><strong>{status === 'loading' ? 'Загрузка 3D-сцены…' : 'Не удалось загрузить 3D-сцену'}</strong>
      {status === 'error' && <><p>Повторите загрузку сцены. Вы также можете выбрать другой этаж в меню лифта.</p><button type="button" onClick={onRetry}>Повторить загрузку</button></>}
    </div>
  </div>
}
