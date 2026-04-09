"use strict";

(function attachMelodySyncSessionListOrderContract(root) {
  const SESSION_LIST_ORDER_SOURCE_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "sidebar_order",
      label: "Manual Sidebar Order",
      description: "Explicit durable ordering stored in session metadata.",
      durable: true,
      hookMutable: false,
    }),
    Object.freeze({
      id: "local_order",
      label: "Local Temporary Order",
      description: "Client-only temporary ordering used during local list interactions.",
      durable: false,
      hookMutable: false,
    }),
    Object.freeze({
      id: "attention_band",
      label: "Attention Band",
      description: "Derived ranking based on unread state, waiting state, and active work.",
      durable: false,
      hookMutable: false,
    }),
    Object.freeze({
      id: "workflow_priority",
      label: "Workflow Priority",
      description: "Durable workflow priority metadata may still influence ordering.",
      durable: true,
      hookMutable: true,
    }),
    Object.freeze({
      id: "pin",
      label: "Pinned Rank",
      description: "Pinned sessions break ties ahead of recency.",
      durable: true,
      hookMutable: false,
    }),
    Object.freeze({
      id: "recency",
      label: "Recent Activity",
      description: "Latest meaningful activity timestamp acts as the final fallback.",
      durable: true,
      hookMutable: false,
    }),
  ]);

  function normalizePositiveInteger(value) {
    const parsed = typeof value === "number"
      ? value
      : Number.parseInt(String(value || "").trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeSessionSidebarOrder(value) {
    return normalizePositiveInteger(value);
  }

  function normalizeSessionLocalListOrder(value) {
    return normalizePositiveInteger(value);
  }

  function listSessionOrderSourceDefinitions() {
    return SESSION_LIST_ORDER_SOURCE_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  root.MelodySyncSessionListOrderContract = {
    SESSION_LIST_ORDER_SOURCE_DEFINITIONS,
    normalizeSessionSidebarOrder,
    normalizeSessionLocalListOrder,
    listSessionOrderSourceDefinitions,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
