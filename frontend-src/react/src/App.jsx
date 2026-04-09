import { SessionListPanel } from "./features/session-list/SessionListPanel.jsx";
import { WorkbenchPanel } from "./features/workbench/WorkbenchPanel.jsx";

const fallbackBootstrap = {
  sessionList: {
    pinned: [
      { id: "react-shell-pinned", title: "React shell", subtitle: "Bridge contract ready", tone: "accent" },
    ],
    groups: [
      {
        id: "progressive-migration",
        title: "Progressive migration",
        sessions: [
          { id: "ui-island", title: "UI island", subtitle: "Session list and shell split" },
          { id: "workbench-island", title: "Workbench island", subtitle: "Next surface boundary" },
        ],
      },
    ],
    archived: [],
  },
  workbench: {
    summary: {
      activeNodes: 2,
      pendingCards: 1,
      connectionState: "ready",
    },
    nodes: [
      { id: "bridge", name: "Bridge", state: "ready" },
      { id: "shell", name: "Shell", state: "mounted" },
    ],
    cards: [
      {
        id: "contract",
        title: "Stable contract",
        description: "React can take over rendering without forcing a backend route change in the same step.",
      },
    ],
  },
};

export function App({ bootstrap = {} }) {
  const sessionList = bootstrap.sessionList || fallbackBootstrap.sessionList;
  const workbench = bootstrap.workbench || fallbackBootstrap.workbench;
  const activeSession = bootstrap.activeSession || bootstrap.session || { title: "MelodySync React shell" };
  const status = bootstrap.status || bootstrap.connectionStatus || "Ready for progressive migration";

  return (
    <div className="ms-react-app">
      <header className="ms-react-hero">
        <div>
          <div className="ms-react-hero__eyebrow">MelodySync</div>
          <h1 className="ms-react-hero__title">React shell, same product surface</h1>
        </div>
        <div className="ms-react-hero__status">{status}</div>
      </header>

      <main className="ms-react-shell">
        <SessionListPanel
          sessionList={sessionList}
          activeSessionId={activeSession?.id || ""}
        />
        <WorkbenchPanel
          workbench={workbench}
          activeSession={activeSession}
        />
      </main>
    </div>
  );
}
