function SessionRow({ session, active, onSelectSession }) {
  const tone = session?.tone || (active ? "active" : "default");
  return (
    <button
      type="button"
      className={`ms-react-session-row ms-react-session-row--${tone}${active ? " is-active" : ""}`}
      onClick={() => onSelectSession?.(session)}
    >
      <span className="ms-react-session-row__title">{session?.title || session?.name || "Untitled session"}</span>
      <span className="ms-react-session-row__meta">{session?.subtitle || session?.status || "No status"}</span>
    </button>
  );
}

function SessionGroup({ group, activeSessionId, onSelectSession, onToggleGroup }) {
  const collapsed = Boolean(group?.collapsed);
  const entries = Array.isArray(group?.sessions) ? group.sessions : [];

  return (
    <section className={`ms-react-session-group${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="ms-react-session-group__header"
        onClick={() => onToggleGroup?.(group)}
      >
        <span>{group?.title || "Sessions"}</span>
        <span className="ms-react-session-group__count">{entries.length}</span>
      </button>
      {!collapsed ? (
        <div className="ms-react-session-group__items">
          {entries.length ? (
            entries.map((session) => (
              <SessionRow
                key={session?.id || session?.key || session?.title}
                session={session}
                active={session?.id === activeSessionId}
                onSelectSession={onSelectSession}
              />
            ))
          ) : (
            <div className="ms-react-empty-state">No sessions in this group.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SessionListPanel({
  sessionList = {},
  activeSessionId = "",
  onSelectSession,
  onToggleGroup,
}) {
  const pinned = Array.isArray(sessionList?.pinned) ? sessionList.pinned : [];
  const groups = Array.isArray(sessionList?.groups) ? sessionList.groups : [];
  const archived = Array.isArray(sessionList?.archived) ? sessionList.archived : [];

  return (
    <aside className="ms-react-panel ms-react-panel--sessions">
      <header className="ms-react-panel__header">
        <div>
          <div className="ms-react-panel__eyebrow">Session-first</div>
          <h2 className="ms-react-panel__title">Sessions</h2>
        </div>
        <div className="ms-react-panel__badge">{pinned.length + groups.length + archived.length}</div>
      </header>

      <div className="ms-react-panel__body">
        {pinned.length ? (
          <section className="ms-react-section">
            <div className="ms-react-section__title">Pinned</div>
            <div className="ms-react-session-group__items">
              {pinned.map((session) => (
                <SessionRow
                  key={session?.id || session?.key || session?.title}
                  session={session}
                  active={session?.id === activeSessionId}
                  onSelectSession={onSelectSession}
                />
              ))}
            </div>
          </section>
        ) : null}

        {groups.length ? (
          <div className="ms-react-stack">
            {groups.map((group) => (
              <SessionGroup
                key={group?.id || group?.key || group?.title}
                group={group}
                activeSessionId={activeSessionId}
                onSelectSession={onSelectSession}
                onToggleGroup={onToggleGroup}
              />
            ))}
          </div>
        ) : null}

        {archived.length ? (
          <section className="ms-react-section">
            <div className="ms-react-section__title">Archived</div>
            <div className="ms-react-session-group__items">
              {archived.map((session) => (
                <SessionRow
                  key={session?.id || session?.key || session?.title}
                  session={session}
                  active={session?.id === activeSessionId}
                  onSelectSession={onSelectSession}
                />
              ))}
            </div>
          </section>
        ) : null}

        {!pinned.length && !groups.length && !archived.length ? (
          <div className="ms-react-empty-state">
            Session data will appear here once the vanilla app hands state to the React shell.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
