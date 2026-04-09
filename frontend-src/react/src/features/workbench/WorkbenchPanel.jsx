function StatCard({ label, value, note }) {
  return (
    <article className="ms-react-stat">
      <div className="ms-react-stat__label">{label}</div>
      <div className="ms-react-stat__value">{value}</div>
      {note ? <div className="ms-react-stat__note">{note}</div> : null}
    </article>
  );
}

function NodeLine({ node }) {
  return (
    <li className="ms-react-node-line">
      <span className="ms-react-node-line__name">{node?.name || node?.title || "Untitled node"}</span>
      <span className="ms-react-node-line__meta">{node?.state || node?.status || "idle"}</span>
    </li>
  );
}

export function WorkbenchPanel({ workbench = {}, activeSession = {} }) {
  const summary = workbench?.summary || {};
  const nodes = Array.isArray(workbench?.nodes) ? workbench.nodes : [];
  const cards = Array.isArray(workbench?.cards) ? workbench.cards : [];
  const currentTitle = activeSession?.title || activeSession?.name || "No session selected";

  return (
    <section className="ms-react-panel ms-react-panel--workbench">
      <header className="ms-react-panel__header ms-react-panel__header--stacked">
        <div>
          <div className="ms-react-panel__eyebrow">Workspace</div>
          <h2 className="ms-react-panel__title">{currentTitle}</h2>
        </div>
        <div className="ms-react-panel__subtle">
          React is now the shell, but the domain data contract stays compatible.
        </div>
      </header>

      <div className="ms-react-panel__body ms-react-workbench">
        <div className="ms-react-stat-grid">
          <StatCard label="Active nodes" value={summary.activeNodes ?? nodes.length ?? 0} note="Graph + task surface" />
          <StatCard label="Pending cards" value={summary.pendingCards ?? cards.length ?? 0} note="Tasks queued for review" />
          <StatCard label="Connection" value={summary.connectionState || "bootstrapping"} note="Bridge-ready contract" />
        </div>

        <div className="ms-react-workbench__columns">
          <section className="ms-react-workbench__surface">
            <div className="ms-react-section__title">Task surface</div>
            <div className="ms-react-surface">
              {cards.length ? (
                cards.map((card) => (
                  <article key={card?.id || card?.title} className="ms-react-card">
                    <div className="ms-react-card__title">{card?.title || "Task card"}</div>
                    <div className="ms-react-card__body">{card?.description || card?.summary || "Placeholder surface for the React migration."}</div>
                  </article>
                ))
              ) : (
                <div className="ms-react-empty-state">
                  The workbench payload can attach here without changing the transport contract.
                </div>
              )}
            </div>
          </section>

          <aside className="ms-react-workbench__inspector">
            <div className="ms-react-section__title">Nodes</div>
            {nodes.length ? (
              <ul className="ms-react-node-list">
                {nodes.map((node) => (
                  <NodeLine key={node?.id || node?.key || node?.name} node={node} />
                ))}
              </ul>
            ) : (
              <div className="ms-react-empty-state">
                Node data will be bridged later from the existing workbench controller.
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
