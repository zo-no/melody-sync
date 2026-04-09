function normalizeBoolean(value) {
  return value === true;
}

export function getTaskMapInteractionConfig({ mobile = false } = {}) {
  const isMobile = normalizeBoolean(mobile);
  return Object.freeze({
    isMobile,
    nodesDraggable: false,
    panOnDrag: !isMobile,
    zoomOnScroll: !isMobile,
    zoomOnPinch: true,
    zoomOnDoubleClick: false,
    preventScrolling: isMobile,
    minZoom: 0.25,
    maxZoom: 1.5,
    nodeDragThreshold: isMobile ? 9999 : 10,
    shellClassName: `quest-task-flow-react-shell${isMobile ? ' is-mobile' : ''}`,
  });
}
