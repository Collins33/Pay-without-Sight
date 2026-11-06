// Step position helpers: progress text, applying an observed stage to the persisted state, and transitions.

export function progressOf(index, total) {
  if (index < 0 || total <= 0) return { step: 0, total: Math.max(total, 0), text: 'Not in a guided step' };
  return { step: index + 1, total, text: `Step ${index + 1} of ${total}` };
}

/**
 * Applies an identified stage to the persisted state. Pure: returns a new state.
 * @param {{workflowId:string|null, stageId:string|null, furthestIndex:number, updatedAt:number}} state
 * @param {{id:string}} workflow
 * @param {{matched:boolean, stage:null|{id:string}, index:number}} identified
 * @param {number} now
 */
export function applyStage(state, workflow, identified, now) {
  if (!identified.matched) return state; // another website: leave the saved position alone
  const sameWorkflow = state.workflowId === workflow.id;
  const base = sameWorkflow ? state : { workflowId: workflow.id, stageId: null, furthestIndex: -1, updatedAt: now };
  const stageId = identified.stage ? identified.stage.id : null;
  const furthestIndex = identified.stage ? Math.max(base.furthestIndex, identified.index) : base.furthestIndex;
  if (stageId === state.stageId && furthestIndex === state.furthestIndex && sameWorkflow) return state;
  return { workflowId: workflow.id, stageId: identified.stage ? stageId : base.stageId, furthestIndex, updatedAt: now };
}

/**
 * Describes a move between two stage ids.
 * @returns {{changed:boolean, direction:'none'|'forward'|'back'|'jump', from:string|null, to:string|null, adjacentForward:boolean}}
 */
export function detectTransition(workflow, fromId, toId) {
  const ids = workflow.stages.map((s) => s.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (!toId || fromId === toId) return { changed: false, direction: 'none', from: fromId, to: toId, adjacentForward: false };
  if (a < 0) return { changed: true, direction: 'jump', from: fromId, to: toId, adjacentForward: false };
  return { changed: true, direction: b > a ? 'forward' : 'back', from: fromId, to: toId, adjacentForward: b === a + 1 };
}
