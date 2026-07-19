import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deployProgressReducer,
  initialDeployProgressState,
  type DeployHistoryRecord,
  type DeployProgressState,
  type DeployRunOutcome,
  type DeployTargetInput,
  type DeployTargetView,
  type WabDriftResult,
  type WabPreflightResult,
} from '../../../shared/deploy';

export interface DeployHook {
  targets: DeployTargetView[];
  selectedTargetId: string | null;
  selectedTarget: DeployTargetView | null;
  /** last_deployed SHA of the active target (for the timeline badge). */
  deployedSha: string | null;
  loading: boolean;
  error: string | null;

  /** Is a deploy/rollback currently running? */
  deploying: boolean;
  /** SHA currently being published via rollback deploy (or null). */
  rollbackSha: string | null;
  progress: DeployProgressState;
  outcome: DeployRunOutcome | null;

  testing: boolean;
  testResult: WabPreflightResult | null;

  drift: WabDriftResult | null;

  history: DeployHistoryRecord[];

  selectTarget(targetId: string): void;
  saveTarget(input: DeployTargetInput): Promise<DeployTargetView | null>;
  deleteTarget(targetId: string): Promise<void>;
  testConnection(targetId: string): Promise<void>;
  publish(): Promise<void>;
  rollbackTo(sha: string): Promise<void>;
  clearTestResult(): void;
}

/**
 * Encapsulates a project's deploy session: loads targets + history, subscribes
 * to progress/target push events, and provides the actions (save, delete, test,
 * publish, rollback deploy). Free of DS/markup — the components (DeployDialog,
 * TimelineSidebar) consume only this state.
 *
 * Secrets flow toward the main process only in `saveTarget`; the renderer never
 * gets a password back, only the `hasCredentials` flag.
 */
export function useDeploy(projectId: string): DeployHook {
  const [targets, setTargets] = useState<DeployTargetView[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deploying, setDeploying] = useState(false);
  const [rollbackSha, setRollbackSha] = useState<string | null>(null);
  const [progress, setProgress] = useState<DeployProgressState>(initialDeployProgressState);
  const [outcome, setOutcome] = useState<DeployRunOutcome | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WabPreflightResult | null>(null);

  const [drift, setDrift] = useState<WabDriftResult | null>(null);
  const [history, setHistory] = useState<DeployHistoryRecord[]>([]);

  // Run ID of the active deploy — only count matching push events.
  const activeRunIdRef = useRef<string | null>(null);
  // Keep the current target selection readable without rebinding the callbacks.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedTargetId;

  const applyTargets = useCallback((next: DeployTargetView[]) => {
    setTargets(next);
    setSelectedTargetId((current) => {
      if (current !== null && next.some((t) => t.id === current)) return current;
      return next[0]?.id ?? null;
    });
  }, []);

  // Load targets + history, subscribe to push events.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDrift(null);
    setTestResult(null);

    window.wab.deploy
      .listTargets(projectId)
      .then((list) => {
        if (cancelled) return;
        applyTargets(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Deploy targets could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    window.wab.deploy
      .history(projectId)
      .then((records) => {
        if (!cancelled) setHistory(records);
      })
      .catch(() => undefined);

    const offProgress = window.wab.events.onDeployProgress((message) => {
      if (message.projectId !== projectId) return;
      if (message.runId !== activeRunIdRef.current) return;
      setProgress((state) => deployProgressReducer(state, message.event));
    });
    const offTargets = window.wab.events.onDeployTargets((message) => {
      if (message.projectId !== projectId) return;
      applyTargets(message.targets);
    });

    return () => {
      cancelled = true;
      offProgress();
      offTargets();
    };
  }, [projectId, applyTargets]);

  const refreshHistory = useCallback(() => {
    window.wab.deploy
      .history(projectId)
      .then(setHistory)
      .catch(() => undefined);
  }, [projectId]);

  // Proactive drift detection (fail-safe, fire-and-forget): the dedicated
  // deploy.drift channel was fully wired but never called — the drift warning
  // only appeared after a manual "Test connection". Now it's checked in the
  // background on target switch/project open; network/auth errors stay silent
  // (warning only on a real finding).
  useEffect(() => {
    if (selectedTargetId === null || deploying) return;
    const target = targets.find((t) => t.id === selectedTargetId);
    if (target === undefined || !target.hasCredentials) return;
    if (target.lastDeployedCommit === undefined) return; // never deployed → nothing to check
    let cancelled = false;
    window.wab.deploy
      .drift(projectId, selectedTargetId)
      .then((result) => {
        if (!cancelled) setDrift(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedTargetId, targets, deploying]);

  const selectTarget = useCallback((targetId: string) => {
    setSelectedTargetId(targetId);
    setTestResult(null);
    setDrift(null);
  }, []);

  const saveTarget = useCallback(
    async (input: DeployTargetInput): Promise<DeployTargetView | null> => {
      setError(null);
      try {
        const saved = await window.wab.deploy.saveTarget(projectId, input);
        const list = await window.wab.deploy.listTargets(projectId);
        setTargets(list);
        setSelectedTargetId(saved.id);
        setTestResult(null);
        return saved;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed.');
        return null;
      }
    },
    [projectId],
  );

  const deleteTarget = useCallback(
    async (targetId: string): Promise<void> => {
      setError(null);
      try {
        await window.wab.deploy.deleteTarget(projectId, targetId);
        const list = await window.wab.deploy.listTargets(projectId);
        applyTargets(list);
        setTestResult(null);
        setDrift(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed.');
      }
    },
    [projectId, applyTargets],
  );

  const testConnection = useCallback(
    async (targetId: string): Promise<void> => {
      setTesting(true);
      setTestResult(null);
      try {
        const result = await window.wab.deploy.test(projectId, targetId);
        setTestResult(result);
        // Derive drift from the preflight: expected SHA (registry) vs. remote.
        const target = targets.find((t) => t.id === targetId);
        const expected = target?.lastDeployedCommit ?? '';
        setDrift({
          drift: (expected === '' ? null : expected) !== result.remoteSha,
          expectedSha: expected,
          remoteSha: result.remoteSha,
        });
      } catch (err) {
        setTestResult({
          ok: false,
          messages: [],
          failures: [err instanceof Error ? err.message : 'Connection test failed.'],
          capabilities: { mkdirRecursive: false, rename: false },
          remoteSha: null,
        });
      } finally {
        setTesting(false);
      }
    },
    [projectId, targets],
  );

  const runDeploy = useCallback(
    async (kind: 'deploy' | 'rollback', sha?: string): Promise<void> => {
      const targetId = selectedRef.current;
      if (targetId === null || deploying) return;
      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;
      setDeploying(true);
      setOutcome(null);
      setProgress(initialDeployProgressState);
      if (kind === 'rollback' && sha !== undefined) setRollbackSha(sha);

      try {
        const result =
          kind === 'rollback' && sha !== undefined
            ? await window.wab.deploy.rollback(projectId, targetId, sha, runId)
            : await window.wab.deploy.run(projectId, targetId, runId);
        setOutcome(result);
        // After a successful deploy the remote state matches again — discard the
        // drift warning (from an earlier test).
        if (result.status === 'deployed') setDrift(null);
      } catch (err) {
        setOutcome({
          status: 'error',
          message: err instanceof Error ? err.message : 'Deploy failed.',
        });
      } finally {
        setDeploying(false);
        setRollbackSha(null);
        activeRunIdRef.current = null;
        refreshHistory();
      }
    },
    [projectId, deploying, refreshHistory],
  );

  const publish = useCallback(() => runDeploy('deploy'), [runDeploy]);
  const rollbackTo = useCallback((sha: string) => runDeploy('rollback', sha), [runDeploy]);
  const clearTestResult = useCallback(() => setTestResult(null), []);

  const selectedTarget = targets.find((t) => t.id === selectedTargetId) ?? null;
  const deployedSha = selectedTarget?.lastDeployedCommit ?? null;

  return {
    targets,
    selectedTargetId,
    selectedTarget,
    deployedSha,
    loading,
    error,
    deploying,
    rollbackSha,
    progress,
    outcome,
    testing,
    testResult,
    drift,
    history,
    selectTarget,
    saveTarget,
    deleteTarget,
    testConnection,
    publish,
    rollbackTo,
    clearTestResult,
  };
}
