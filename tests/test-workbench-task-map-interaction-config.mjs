#!/usr/bin/env node
import assert from 'assert/strict';

import { getTaskMapInteractionConfig } from '../frontend-src/workbench/task-map-interaction-config.js';

const desktopConfig = getTaskMapInteractionConfig({ mobile: false });
assert.equal(desktopConfig.isMobile, false);
assert.equal(desktopConfig.nodesDraggable, true, 'desktop task map should stay freely draggable');
assert.equal(desktopConfig.panOnDrag, true, 'desktop task map should restore left-drag panning on the canvas background');
assert.equal(desktopConfig.zoomOnScroll, true, 'desktop task map should keep wheel zoom enabled');
assert.equal(desktopConfig.nodeDragThreshold, 12, 'desktop drag threshold should be raised so clicks do not collapse into accidental drags');
assert.equal(desktopConfig.shellClassName, 'quest-task-flow-react-shell');

const mobileConfig = getTaskMapInteractionConfig({ mobile: true });
assert.equal(mobileConfig.isMobile, true);
assert.equal(mobileConfig.nodesDraggable, false, 'mobile task map should prefer action taps over node dragging');
assert.equal(mobileConfig.panOnDrag, true, 'mobile task map should still allow dragging the canvas background');
assert.equal(mobileConfig.zoomOnScroll, false, 'mobile task map should not depend on wheel zoom');
assert.equal(mobileConfig.zoomOnPinch, true, 'mobile task map should keep pinch zoom enabled');
assert.equal(mobileConfig.nodeDragThreshold, 18, 'mobile drag threshold should be raised to avoid accidental drags');
assert.equal(mobileConfig.shellClassName, 'quest-task-flow-react-shell is-mobile');

console.log('test-workbench-task-map-interaction-config: ok');
