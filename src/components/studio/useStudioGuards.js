import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Studio dirty-navigation guards (Studio PR 3, Codex F10).
 *
 * Three layers:
 *  1. beforeunload — tab close / refresh / external navigation (browser-native
 *     confirm; the only thing the platform allows there).
 *  2. popstate sentinel — browser Back is a same-document history transition
 *     under BrowserRouter, which beforeunload does NOT cover. While dirty, one
 *     sentinel history entry is pushed; pressing Back pops it, we immediately
 *     re-push and raise the guard modal instead of losing the edits. Known
 *     wart (documented): after saving, the consumed-less sentinel means one
 *     extra Back press on a clean Studio — harmless, never data-losing. We
 *     never pop history programmatically on cleanup: doing so would undo a
 *     legitimate in-app navigation that unmounted the Studio.
 *  3. guardedRun — Studio-owned actions (campaign switch, back-to-workspace,
 *     copy link, share preview) route through the guard modal while dirty.
 *
 * `dirty` here is the UNIFIED flag (document dirty OR unsaved slug draft).
 */
export default function useStudioGuards({ dirty }) {
  const [guard, setGuard] = useState(null); // { kind, action? } | null
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const bypassRef = useRef(false);
  const sentinelRef = useRef(false);

  useEffect(() => {
    const handler = (e) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    if (!sentinelRef.current) {
      // One sentinel per Studio visit — repeated dirty↔clean cycles must not
      // stack entries (each would cost the user an extra Back press).
      window.history.pushState({ __studioGuard: true }, '');
      sentinelRef.current = true;
    }
    const onPop = () => {
      if (bypassRef.current || !dirtyRef.current) return;
      window.history.pushState({ __studioGuard: true }, '');
      setGuard({ kind: 'back-browser' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dirty]);

  /** Run `action` now, or park it behind the guard modal while dirty. */
  const guardedRun = useCallback((kind, action) => {
    if (dirtyRef.current) setGuard({ kind, action });
    else action();
  }, []);

  /** Leave via history after a Back-press guard (skips the re-pushed sentinel). */
  const leaveViaHistory = useCallback(() => {
    bypassRef.current = true;
    window.history.go(-2);
  }, []);

  const closeGuard = useCallback(() => setGuard(null), []);

  return { guard, guardedRun, leaveViaHistory, closeGuard };
}
