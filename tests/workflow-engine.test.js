// Unit tests for the workflow engine, step manager, persisted workflow state and app preferences.
import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../src/workflow/workflow-engine.js';
import { applyStage, detectTransition, progressOf } from '../src/workflow/step-manager.js';
import { defaultWorkflowState, loadWorkflowState, saveWorkflowState, sanitizeWorkflowState, WORKFLOW_KEY } from '../src/workflow/workflow-state.js';
import { loadPrefs, savePrefs, sanitizePrefs, DEFAULT_PREFS, PREFS_KEY } from '../src/prefs/app-prefs.js';
import { createMemoryStorage } from '../src/prefs/storage-adapter.js';
import { DEMO_WORKFLOW } from '../src/demo/demo-workflow.js';

const engine = new WorkflowEngine(DEMO_WORKFLOW);
const url = (p) => `http://localhost:4173${p}`;

describe('WorkflowEngine.identify', () => {
  it('identifies each demo stage by host and path', () => {
    const ids = ['/personal.html', '/service.html', '/review.html', '/payment.html', '/receipt.html'].map((p) => engine.identify(url(p)).stage.id);
    expect(ids).toEqual(['personal', 'service', 'review', 'payment', 'receipt']);
    expect(engine.identify(url('/review.html'))).toMatchObject({ matched: true, index: 2, total: 5 });
  });

  it('ignores query strings and works on 127.0.0.1', () => {
    expect(engine.identify('http://127.0.0.1:4173/personal.html?error=1').stage.id).toBe('personal');
  });

  it('matches the demo host but no stage on the home page', () => {
    expect(engine.identify(url('/'))).toMatchObject({ matched: true, stage: null, index: -1 });
  });

  it('does not match other sites, ports, schemes or bad URLs, whatever they claim', () => {
    for (const href of ['https://example.org/payment.html', 'http://localhost:9999/payment.html', 'https://localhost:4173/payment.html', 'file:///payment.html', 'nonsense', '', undefined]) {
      expect(engine.identify(href).matched).toBe(false);
    }
  });
});

describe('instructions', () => {
  const stage = (id) => DEMO_WORKFLOW.stages.find((s) => s.id === id);
  const page = (counts, errors = []) => ({ counts: { fields: 4, requiredEmpty: 0, requiredSensitive: 0, ...counts }, errors });

  it('falls back to the static instruction without page data', () => {
    expect(engine.nextInstruction(stage('personal'), null)).toBe(stage('personal').instruction);
  });
  it('puts errors first', () => {
    expect(engine.nextInstruction(stage('personal'), page({}, [{ text: 'Phone is wrong' }]))).toContain('Fix this first: Phone is wrong');
  });
  it('counts required fields still empty', () => {
    expect(engine.nextInstruction(stage('personal'), page({ requiredEmpty: 1 }))).toContain('1 required field is still empty');
    expect(engine.nextInstruction(stage('personal'), page({ requiredEmpty: 3 }))).toContain('3 required fields are still empty');
  });
  it('points to the panel confirmation on consequential steps', () => {
    expect(engine.nextInstruction(stage('payment'), page({}))).toContain('confirm the payment in the panel');
    expect(engine.nextInstruction(stage('review'), page({ requiredSensitive: 1 }))).toContain('sensitive fields yourself');
  });
  it('suggests continue on ordinary complete steps', () => {
    expect(engine.nextInstruction(stage('personal'), page({}))).toContain('Say "continue"');
  });
  it('explains stages and unknown pages', () => {
    expect(engine.explain(stage('payment'), null)).toContain('simulated payment');
    expect(engine.explain(null, null)).toContain('not one of the guided steps');
  });
});

describe('step manager', () => {
  it('formats progress as text', () => {
    expect(progressOf(1, 5)).toEqual({ step: 2, total: 5, text: 'Step 2 of 5' });
    expect(progressOf(-1, 5).text).toBe('Not in a guided step');
  });

  it('applies stages, tracking the furthest step reached', () => {
    let s = defaultWorkflowState();
    s = applyStage(s, DEMO_WORKFLOW, engine.identify(url('/service.html')), 10);
    expect(s).toMatchObject({ workflowId: DEMO_WORKFLOW.id, stageId: 'service', furthestIndex: 1 });
    s = applyStage(s, DEMO_WORKFLOW, engine.identify(url('/personal.html')), 20);
    expect(s).toMatchObject({ stageId: 'personal', furthestIndex: 1 });
  });

  it('leaves the saved position alone on other websites', () => {
    const s = { workflowId: DEMO_WORKFLOW.id, stageId: 'review', furthestIndex: 2, updatedAt: 1 };
    expect(applyStage(s, DEMO_WORKFLOW, engine.identify('https://example.org/'), 5)).toBe(s);
  });

  it('detects transitions', () => {
    expect(detectTransition(DEMO_WORKFLOW, 'review', 'payment')).toMatchObject({ changed: true, direction: 'forward', adjacentForward: true });
    expect(detectTransition(DEMO_WORKFLOW, 'review', 'receipt')).toMatchObject({ direction: 'forward', adjacentForward: false });
    expect(detectTransition(DEMO_WORKFLOW, 'payment', 'service')).toMatchObject({ direction: 'back' });
    expect(detectTransition(DEMO_WORKFLOW, null, 'payment')).toMatchObject({ direction: 'jump', adjacentForward: false });
    expect(detectTransition(DEMO_WORKFLOW, 'review', 'review').changed).toBe(false);
  });
});

describe('persistence', () => {
  it('workflow state round-trips through storage (survives a service worker restart)', async () => {
    const storage = createMemoryStorage();
    await saveWorkflowState(storage, { workflowId: 'w', stageId: 'payment', furthestIndex: 3, updatedAt: 99 });
    const reborn = await loadWorkflowState(storage);
    expect(reborn).toEqual({ workflowId: 'w', stageId: 'payment', furthestIndex: 3, updatedAt: 99 });
    expect(Object.keys(storage._dump())).toEqual([WORKFLOW_KEY]);
  });

  it('corrupted workflow state falls back to the default', () => {
    for (const bad of [null, 'x', 5, { furthestIndex: 'a', stageId: 7 }, { furthestIndex: 9999 }]) {
      const s = sanitizeWorkflowState(bad);
      expect(s.furthestIndex).toBe(-1);
      expect(s.stageId === null || typeof s.stageId === 'string').toBe(true);
    }
  });

  it('prefs default, round-trip and are namespaced under pws.', async () => {
    const storage = createMemoryStorage();
    expect(await loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.readBackEnabled).toBe(false);
    await savePrefs(storage, { verbosity: 'minimal', readBackEnabled: true });
    expect(await loadPrefs(storage)).toEqual({ verbosity: 'minimal', readBackEnabled: true, textSize: 'normal' });
    await savePrefs(storage, { textSize: 'large' });
    expect(await loadPrefs(storage)).toEqual({ verbosity: 'minimal', readBackEnabled: true, textSize: 'large' });
    expect(Object.keys(storage._dump()).every((k) => k.startsWith('pws.'))).toBe(true);
    expect(PREFS_KEY.startsWith('pws.')).toBe(true);
  });

  it('prefs reject invalid values and unknown keys', () => {
    const p = sanitizePrefs({ verbosity: 'shouty', readBackEnabled: 'yes', textSize: 'huge', evil: true, __proto__: { x: 1 } });
    expect(p).toEqual(DEFAULT_PREFS);
    expect(Object.hasOwn(p, 'evil')).toBe(false);
  });
});
