// Config-driven workflow engine: identifies the current stage from the URL and words the next instruction.
import { progressOf } from './step-manager.js';

export class WorkflowEngine {
  /** @param {object} config a workflow config such as DEMO_WORKFLOW */
  constructor(config) {
    this.config = config;
  }

  get total() {
    return this.config.stages.length;
  }

  /** Works out which stage (if any) a URL belongs to. Matching is by exact origin (scheme, host, port) and path only, never by page content. */
  identify(href) {
    const none = { matched: false, workflow: null, stage: null, index: -1, total: this.total };
    let url;
    try {
      url = new URL(href);
    } catch {
      return none;
    }
    if (!this.config.origins.includes(url.origin)) return none;
    const index = this.config.stages.findIndex((s) => s.path === url.pathname);
    return { matched: true, workflow: this.config, stage: index >= 0 ? this.config.stages[index] : null, index, total: this.total };
  }

  progress(index) {
    return progressOf(index, this.total);
  }

  stageById(id) {
    const index = this.config.stages.findIndex((s) => s.id === id);
    return index >= 0 ? { stage: this.config.stages[index], index } : null;
  }

  /**
   * One short instruction for what to do now.
   * @param {object|null} stage
   * @param {{counts:object, errors:{text:string}[]}|null} page summary from the last page read
   */
  nextInstruction(stage, page) {
    if (!stage) return 'Open a step of the guided service to get instructions, or say "help".';
    if (!page) return stage.instruction;
    const c = page.counts ?? {};
    if (page.errors?.length) return `Fix this first: ${page.errors[0].text} Say "next" to go to the field that needs attention.`;
    if ((c.requiredEmpty ?? 0) > 0) {
      return `${c.requiredEmpty} required ${c.requiredEmpty === 1 ? 'field is' : 'fields are'} still empty. Say "next" to go to ${c.requiredEmpty === 1 ? 'it' : 'the first one'}.`;
    }
    const sensitiveNote = (c.requiredSensitive ?? 0) > 0 ? ' Check the sensitive fields yourself; I cannot see them.' : '';
    if (stage.consequential) return `${stage.readyInstruction}${sensitiveNote}`;
    return `All required fields look complete. Say "continue" to move on.${sensitiveNote}`;
  }

  /** Plain-language summary of what a stage needs. */
  explain(stage, page) {
    if (!stage) return 'This page is not one of the guided steps. I can still list fields and take you to them.';
    const c = page?.counts;
    const status = c ? ` Right now: ${c.fields} fields, ${c.requiredEmpty} required still empty.` : '';
    return `${stage.explain}${status}`;
  }
}
