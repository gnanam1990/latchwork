'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyStagedProposal,
  calculateMetrics,
  initialWorkspace,
  stageSaferPlan,
  type LaneId,
} from '../lib/planning';
import { installDocumentTools } from '../lib/webmcp';

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
  const [workspace, setWorkspace] = useState(() => stageSaferPlan(initialWorkspace));
  const workspaceRef = useRef(workspace);
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
    workspaceRef.current = workspace;
  }, [workspace]);

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
      workspaceRef.current = staged;
      setWorkspace(staged);
      return staged.proposal!;
    },
  }), []);

  const stageProposal = () => setWorkspace((current) => stageSaferPlan(current));
  const applyProposal = () => setWorkspace((current) => applyStagedProposal(current));

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
          <span className="sync-state"><i /> Local planner ready</span>
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
              <button className="dark-button" type="button" onClick={stageProposal}><span>✦</span> Ask agent</button>
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

          <div className="agent-message">
            <span className="message-label">{workspace.proposal ? 'Proposal 01' : 'Plan aligned'}</span>
            <h3>{workspace.proposal ? 'I found a safer path that still makes Friday.' : 'The safer sequence is now active.'}</h3>
            <p>{workspace.proposal
              ? 'Moving the dependency check ahead of tool integration removes both handoff risks without touching your locked decisions.'
              : 'Every locked decision stayed intact. Ask the planner whenever the workspace changes.'}</p>
          </div>

          <div className="change-preview">
            <span className="change-kicker">{workspace.proposal ? '2 staged changes' : 'No pending changes'}</span>
            {workspace.proposal ? (
              <>
                <div className="change-row"><i className="move-up">↑</i><p><strong>Verify dependency graph</strong><br /><span>Move before integration</span></p></div>
                <div className="change-row"><i className="time-save">−</i><p><strong>Tool integration</strong><br /><span>Remove 2 tight handoffs</span></p></div>
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
