import { computeReadiness } from '../services/campaignReadinessService.js';

const codes = (r) => r.issues.map((i) => i.code);

describe('campaignReadinessService.computeReadiness', () => {
  const healthy = {
    type: 'quiz',
    isActive: true,
    isQuiz: true,
    quizEnabled: true,
    assignableAgents: 3,
    agentsMissingPhone: 0,
    webhookEnabled: true,
  };

  it('is ready with a healthy quiz campaign', () => {
    const r = computeReadiness(healthy);
    expect(r.applicable).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('is NOT applicable for brand_awareness (PHV) campaigns', () => {
    const r = computeReadiness({ ...healthy, type: 'brand_awareness', assignableAgents: 0 });
    expect(r.applicable).toBe(false);
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags an empty agent pool as critical (not ready)', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 0 });
    expect(r.ready).toBe(false);
    expect(codes(r)).toContain('no_agent_pool');
    expect(r.issues.find((i) => i.code === 'no_agent_pool').level).toBe('critical');
  });

  it('flags a disabled webhook as critical (not ready)', () => {
    const r = computeReadiness({ ...healthy, webhookEnabled: false });
    expect(r.ready).toBe(false);
    expect(codes(r)).toContain('webhook_disabled');
  });

  it('warns (but stays ready) when some pool agents have no phone', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 2, agentsMissingPhone: 1 });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('agents_missing_phone');
    expect(r.issues.find((i) => i.code === 'agents_missing_phone').level).toBe('warning');
  });

  it('warns when a quiz campaign has the quiz disabled', () => {
    const r = computeReadiness({ ...healthy, quizEnabled: false });
    expect(r.ready).toBe(true);
    expect(codes(r)).toContain('quiz_not_enabled');
  });

  it('adds an info note when the campaign is not active', () => {
    const r = computeReadiness({ ...healthy, isActive: false });
    expect(r.ready).toBe(true); // info-only doesn't block
    expect(codes(r)).toContain('not_active');
  });

  it('accumulates multiple criticals (empty pool + webhook off)', () => {
    const r = computeReadiness({ ...healthy, assignableAgents: 0, webhookEnabled: false });
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['no_agent_pool', 'webhook_disabled']));
  });

  it('does not flag missing-phone for a regular lead_generation campaign that is otherwise healthy', () => {
    const r = computeReadiness({
      type: 'lead_generation', isActive: true, isQuiz: false, quizEnabled: false,
      assignableAgents: 1, agentsMissingPhone: 0, webhookEnabled: true,
    });
    expect(r.ready).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});
