import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { OfficeScene3DProps } from '../office-3d/OfficeScene3D';
import SceneStatusOverlay, { type SceneStatus } from '../office-ui/components/SceneStatus';
import { traceTower } from './diagnostics';

const OfficeScene3D = lazy(() => import('../office-3d/OfficeScene3D'));

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { traceTower('scene-boundary-error', { message: error.message, stack: error.stack?.slice(0, 1200) }); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Each floor visit/retry owns its status; an old renderer cannot update a new visit. */
function SceneAttempt(props: OfficeScene3DProps & { onRetry: () => void }) {
  const [status, setStatus] = useState<SceneStatus>('loading');
  const reportStatus = useCallback((next: SceneStatus) => {
    setStatus(next);
    traceTower('scene-status', { status: next });
  }, []);
  const reportError = useCallback(() => reportStatus('error'), [reportStatus]);
  const { onRetry, ...sceneProps } = props;
  return <>
    <SceneBoundary onError={reportError}><OfficeScene3D {...sceneProps} onSceneStatusChange={reportStatus} /></SceneBoundary>
    <SceneStatusOverlay status={status} onRetry={onRetry} />
  </>;
}

export default function PremiumFloorScene(props: OfficeScene3DProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    traceTower('premium-floor-mount');
    return () => traceTower('premium-floor-unmount');
  }, []);
  return <Suspense fallback={<SceneStatusOverlay status="loading" onRetry={retry} />}><SceneAttempt key={attempt} {...props} onRetry={retry} /></Suspense>;
}
