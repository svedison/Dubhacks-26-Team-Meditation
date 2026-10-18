import { randomUUID } from 'node:crypto';
import { DAY } from './clock.ts';
import { MemoryService } from './memory.ts';
import { evaluateRules } from './anomalies.ts';
import type { Finding, RuleContext } from './anomalies.ts';
import type { Alert } from './types.ts';
export class RoleDService extends MemoryService {
  recordAnomaly(finding: Finding, eventId: string): Alert {
    if (!eventId?.trim() || !Number.isInteger(finding.rule) || finding.rule < 1 || finding.rule > 8
      || !['red', 'yellow'].includes(finding.level) || !finding.title?.trim() || !finding.body?.trim()) throw new Error('Invalid anomaly');
    const key = `${eventId}:${finding.rule}`;
    const existing = this.state.alertEvents[key];
    if (existing) return structuredClone(this.state.alerts.find(a => a.id === existing)!);
    const alert: Alert = {id: `al_${randomUUID()}`, ...finding, grandma_note: null, created_at: this.now(), archived: false};
    this.state.alerts.push(alert); this.state.alertEvents[key] = alert.id;
    const yellow = this.state.alerts.filter(a => a.level === 'yellow' && !a.archived
      && !this.state.pushedAlerts.includes(a.id) && Date.parse(a.created_at) > Date.parse(this.now()) - 7 * DAY && a.created_at <= this.now());
    if (alert.level === 'red' || yellow.length >= 2) {
      const sharing = alert.level === 'red' ? [alert] : yellow;
      this.state.pushedAlerts.push(...sharing.map(a => a.id));
      this.state.noteQueue.push(alert.id);
      // Safety notice preempts a reminder; its next reply is explanation, not a dose/receipt confirmation.
      for (const prompt of this.state.prompts) delete prompt.askedAt;
      this.say("I'll let your daughter know, okay?");
      this.publish('guardian', {type: 'alert', ...alert});
    }
    this.save(); return structuredClone(alert);
  }
  evaluateAnomalies(context: Omit<RuleContext, 'now' | 'products' | 'orders' | 'memories'>, eventId: string): Alert[] {
    return evaluateRules({...context, now: this.now(), products: this.products(), orders: this.state.orders, memories: this.state.memories})
      .map(finding => this.recordAnomaly(finding, eventId));
  }
  override handleAnswer(text: string): boolean {
    if (this.state.noteQueue.length && typeof text === 'string' && text.trim()) {
      const ids = this.state.noteQueue.splice(0);
      for (const id of ids) {
        const alert = this.state.alerts.find(a => a.id === id)!;
        alert.grandma_note = text;
        this.publish('guardian', {type: 'alert', ...alert});
      }
      this.dispatch(); return true;
    }
    return super.handleAnswer(text);
  }
  archiveAlert(id: string): Alert {
    const alert = this.state.alerts.find(a => a.id === id);
    if (!alert) throw new Error('Alert not found');
    alert.archived = true; this.publish('guardian', {type: 'alert', ...alert}); return structuredClone(alert);
  }
}
