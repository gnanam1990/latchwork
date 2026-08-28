'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyStagedProposal,
  calculateMetrics,
  initialWorkspace,
  stageSaferPlan,
  type LaneId,
  type WorkspaceState,
} from '../lib/planning';
import {
  acceptLocalAgentResult,
  runLocalAgent,
  type LocalTextModel,
} from '../lib/local-agent';
import { installDocumentTools } from '../lib/webmcp';
import {
  createBrowserLocalModel,
  DEFAULT_LOCAL_MODEL,
  supportsWebGpu,
} from '../lib/webllm-engine';

type ModelStatus = 'checking' | 'unsupported' | 'idle' | 'loading' | 'ready' | 'thinking' | 'error';

const laneOrder: Array<{ id: LaneId; title: string }> = [
  { id: 'now', title: 'Now' },
  { id: 'next', title: 'Next' },
  { id: 'ready', title: 'Ready' },
];

function formatMinutes(minutes: number, launch: boolean | undefined): string {
  if (launch) return 'Fri · 5 PM';
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export default function Home() {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('checking');
  const [modelProgress, setModelProgress] = useState(0);
  const [modelDetail, setModelDetail] = useState('Checking WebGPU support…');
  const [agentRequest, setAgentRequest] = useState('Find a safer plan without moving locked work.');
  const [agentRationale, setAgentRationale] = useState('Load the local model, then ask it to inspect this plan.');
  const workspaceRef = useRef(workspace);
  const workspaceRevisionRef = useRef(0);
  const modelRef = useRef<LocalTextModel | null>(null);
  const mountedRef = useRef(true);
  const commitWorkspace = useCallback((next: WorkspaceState) => {
    if (next === workspaceRef.current) return;
    workspaceRef.current = next;
    workspaceRevisionRef.current += 1;
    setWorkspace(next);
  }, []);
  const metrics = calculateMetrics(workspace.steps);
  const lanes = useMemo(
    () => laneOrder.map((lane) => ({
      ...lane,
      cards: workspace.steps
        .filter((step) => step.lane === lane.id)
        .sort((left, right) => left.position - right.position),
    })),
    [workspace.steps],
  );

  useEffect(() => {
    const updateSupport = () => {
      if (!mountedRef.current) return;
      if (supportsWebGpu()) {
        setModelStatus('idle');
        setModelDetail('WebGPU ready · model not loaded');
      } else {
        setModelStatus('unsupported');
        setModelDetail('WebGPU unavailable · safe planner still works');
      }
    };
    queueMicrotask(updateSupport);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const model = modelRef.current;
      modelRef.current = null;
      void model?.dispose?.();
    };
  }, []);

  useEffect(() => installDocumentTools({
    getState: () => workspaceRef.current,
    findConflicts: () => {
      const current = calculateMetrics(workspaceRef.current.steps);
      return {
        conflicts: current.conflicts,
        tightHandoffs: current.tightHandoffs,
        details: current.tightHandoffs > 0
          ? ['Dependency verification currently follows WebMCP integration.']
          : [],
      };
    },
    stageSaferPlan: () => {
      const staged = stageSaferPlan(workspaceRef.current);
      commitWorkspace(staged);
      return staged.proposal;
    },
  }), [commitWorkspace]);

  const stageProposal = () => {
    commitWorkspace(stageSaferPlan(workspaceRef.current));
    setAgentRationale('The deterministic safety planner found the dependency handoff and staged one reviewable change.');
  };
  const applyProposal = () => commitWorkspace(applyStagedProposal(workspaceRef.current));

  const loadLocalModel = async () => {
    setModelStatus('loading');
    setModelProgress(0);
    setModelDetail('Starting private model download…');
    try {
      const previousModel = modelRef.current;
      modelRef.current = null;
      await previousModel?.dispose?.();
      const model = await createBrowserLocalModel(({ progress, text }) => {
        if (!mountedRef.current) return;
        setModelProgress(Math.max(0, Math.min(1, progress)));
        setModelDetail(text || 'Loading local model…');
      });
      if (!mountedRef.current) {
        await model.dispose?.();
        return;
      }
      modelRef.current = model;
      setModelProgress(1);
      setModelStatus('ready');
      setModelDetail('Ready · inference stays in this browser');
    } catch (error) {
      if (!mountedRef.current) return;
      modelRef.current = null;
      setModelStatus('error');
      setModelDetail(error instanceof Error ? error.message : 'Local model failed to load.');
    }
  };

  const askLocalModel = async () => {
    const model = modelRef.current;
    if (!model) return;
    const startRevision = workspaceRevisionRef.current;
    const startWorkspace = workspaceRef.current;
    setModelStatus('thinking');
    setModelDetail('Reasoning locally…');
    try {
      const result = await runLocalAgent(model, startWorkspace, agentRequest);
      const acceptedWorkspace = acceptLocalAgentResult(
        result,
        startRevision,
        workspaceRevisionRef.current,
      );
      if (!acceptedWorkspace) {
        setModelStatus('ready');
        setModelDetail('Decision discarded · workspace changed while the model was thinking');
        setAgentRationale('The workspace changed before that decision finished. Run it again against the latest plan.');
        return;
      }
      commitWorkspace(acceptedWorkspace);
      setAgentRationale(result.decision.rationale);
      setModelStatus('ready');
      setModelDetail('Ready · last decision validated');
    } catch (error) {
      setModelStatus('ready');
      setModelDetail(error instanceof Error
        ? `Decision rejected · ${error.message}`
        : 'Decision rejected · local output could not be validated.');
    }
  };

  const modelStatusLabel = modelStatus === 'ready' || modelStatus === 'thinking'
    ? 'Local model ready'
    : 'Safe planner ready';

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Latchwork home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Latchwork</span>
        </a>
        <div className="project-switcher">
          <span className="project-dot" />
          <strong>WebMCP Launch</strong>
          <span className="chevron">⌄</span>
        </div>
        <div className="top-actions">
          <span className="sync-state"><i /> {modelStatusLabel}</span>
          <button className="avatar" type="button" aria-label="Open profile">GS</button>
        </div>
      </header>

      <section className="workspace" id="workspace">
        <aside className="constraints-panel">
          <div className="eyebrow-row">
            <span className="eyebrow">Locked context</span>
            <button className="icon-button" type="button" aria-label="Add constraint">+</button>
          </div>
          <h1>Lock what matters.<br />Solve the rest.</h1>
          <p className="intro">Your non-negotiables stay fixed while the agent explores every viable path.</p>

          <div className="constraint-list">
            {workspace.constraints.map((constraint, index) => (
              <article className="constraint-card" key={constraint.label}>
                <span className={`constraint-icon ${['coral', 'blue', 'lime'][index]}`} aria-hidden="true">⌁</span>
                <div>
                  <span>{constraint.label}</span>
                  <strong>{constraint.value}</strong>
                </div>
                <span className="mini-lock" aria-label="Locked">●</span>
              </article>
            ))}
          </div>

          <button className="add-constraint" type="button"><span>+</span> Add constraint</button>
          <div className="privacy-note">
            <span className="privacy-pulse" />
            <p><strong>Private by design</strong><br />Planning stays in this browser.</p>
          </div>
        </aside>

        <section className="board-panel" aria-label="Launch plan">
          <div className="board-heading">
            <div>
              <span className="eyebrow">Active scenario</span>
              <h2>{workspace.scenario}</h2>
            </div>
            <div className="board-actions">
              <button className="ghost-button" type="button"><span>↗</span> Compare</button>
              <button className="dark-button" type="button" onClick={stageProposal}><span>✦</span> Safe planner</button>
            </div>
          </div>

          <div className="health-strip">
            <span><i className="health-dot green" /> {metrics.conflicts} conflicts</span>
            <span><i className="health-dot amber" /> {metrics.tightHandoffs} tight handoffs</span>
            <span><i className="health-dot blue" /> {(metrics.focusedMinutes / 60).toFixed(1)}h focused work</span>
          </div>

          <div className="lanes">
            {lanes.map((lane) => (
              <section className="lane" key={lane.id}>
                <header>
                  <h3>{lane.title}</h3>
                  <span>{lane.cards.length}</span>
                </header>
                <div className="lane-stack">
                  {lane.cards.map((card) => (
                    <article
                      className={`work-card ${card.accent ? 'agent-card' : ''} ${card.launch ? 'launch-card' : ''}`}
                      key={card.id}
                    >
                      <div className="card-topline">
                        <span className="drag-handle" aria-hidden="true">⠿</span>
                        {card.locked && <span className="locked-pill">Locked</span>}
                      </div>
                      <h4>{card.title}</h4>
                      <footer>
                        <span className="owner"><i>{card.owner.slice(0, 1)}</i>{card.owner}</span>
                        <span>{formatMinutes(card.minutes, card.launch)}</span>
                      </footer>
                    </article>
                  ))}
                </div>
                <button className="lane-add" type="button">+ Add step</button>
              </section>
            ))}
          </div>
        </section>

        <aside className="agent-panel">
          <div className="agent-heading">
            <div className="agent-orb" aria-hidden="true"><span /></div>
            <div><span className="eyebrow">Local collaborator</span><h2>Agent</h2></div>
            <button className="more-button" type="button" aria-label="Agent options">•••</button>
          </div>

          <section className="model-card" aria-label="Browser-local model">
            <div className="model-status-row">
              <span className={`model-status-dot ${modelStatus}`} />
              <strong>{modelStatus === 'ready' ? 'Local model online' : modelStatus === 'thinking' ? 'Thinking locally' : 'Local model'}</strong>
              <span className="model-size">~0.9 GB</span>
            </div>
            <p>{modelDetail}</p>
            {modelStatus === 'loading' && (
              <div className="model-progress" aria-label={`Model loading ${Math.round(modelProgress * 100)}%`}>
                <i style={{ width: `${Math.round(modelProgress * 100)}%` }} />
              </div>
            )}
            {(modelStatus === 'idle' || modelStatus === 'error') && (
              <button className="load-model-button" type="button" onClick={loadLocalModel}>
                {modelStatus === 'error' ? 'Retry model load' : `Load ${DEFAULT_LOCAL_MODEL.replace('-q4f16_1-MLC', '')}`}
              </button>
            )}
            {modelStatus === 'unsupported' && <span className="model-help">Use a WebGPU browser to enable the language model.</span>}
          </section>

          <div className="agent-compose">
            <label htmlFor="agent-request">Ask the local collaborator</label>
            <textarea
              id="agent-request"
              value={agentRequest}
              onChange={(event) => setAgentRequest(event.target.value)}
              rows={3}
              maxLength={280}
            />
            <button
              className="run-model-button"
              type="button"
              onClick={askLocalModel}
              disabled={modelStatus !== 'ready' || !agentRequest.trim()}
            >
              {modelStatus === 'thinking' ? 'Thinking…' : 'Run locally'} <span>✦</span>
            </button>
          </div>

          <div className="agent-message">
            <span className="message-label">{workspace.proposal ? 'Proposal 01' : 'Ready to inspect'}</span>
            <h3>{workspace.proposal ? 'A safer path is staged for your review.' : 'Your locked decisions remain untouched.'}</h3>
            <p>{agentRationale}</p>
          </div>

          <div className="change-preview">
            <span className="change-kicker">{workspace.proposal
              ? `${workspace.proposal.moves.length} staged change${workspace.proposal.moves.length === 1 ? '' : 's'}`
              : 'No pending changes'}</span>
            {workspace.proposal ? (
              <>
                <div className="change-row"><i className="move-up">↑</i><p><strong>Verify dependency graph</strong><br /><span>Move before integration</span></p></div>
                <div className="change-row"><i className="time-save">−</i><p><strong>Expected impact</strong><br /><span>Remove 2 tight handoffs</span></p></div>
              </>
            ) : (
              <div className="change-row"><i className="time-save">✓</i><p><strong>Constraints preserved</strong><br /><span>Plan is ready to continue</span></p></div>
            )}
          </div>

          <div className="approval-box">
            <button className="approve-button" type="button" onClick={applyProposal} disabled={!workspace.proposal}>Apply proposed plan <span>→</span></button>
            <button className="explain-button" type="button">Explain the tradeoffs</button>
          </div>
          <p className="approval-note"><span>●</span> Nothing changes until you approve.</p>
        </aside>
      </section>
    </main>
  );
}
