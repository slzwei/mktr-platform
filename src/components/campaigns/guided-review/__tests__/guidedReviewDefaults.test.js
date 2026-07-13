import { describe, expect, it } from 'vitest';
import {
  GUIDED_REVIEW_TEMPLATES,
  createGuidedReviewTemplate,
  applyGuidedReviewAiDraft,
  guidedReviewToQuiz,
  normalizeGuidedReview,
  reorderGuidedReviewSections,
  rewardConditionLabel,
} from '../guidedReviewDefaults';

describe('Guided Review templates', () => {
  it('provides three distinct campaign starting points', () => {
    expect(GUIDED_REVIEW_TEMPLATES.map((template) => template.id)).toEqual([
      'financial_readiness',
      'prenatal_money_review',
      'general_wellness',
    ]);
    expect(createGuidedReviewTemplate('prenatal_money_review').hero.headline).toContain('baby');
    expect(createGuidedReviewTemplate('general_wellness').review.duration).toBe('60 minutes');
    const themes = GUIDED_REVIEW_TEMPLATES.map((template) => template.theme.accent);
    expect(new Set(themes).size).toBe(3);
    for (const template of GUIDED_REVIEW_TEMPLATES) {
      expect(createGuidedReviewTemplate(template.id).theme).toEqual(template.theme);
    }
  });

  it('normalizes stored edits against their selected template', () => {
    const content = normalizeGuidedReview({
      templateId: 'prenatal_money_review',
      hero: { headline: 'Our custom family headline' },
    });
    expect(content.hero.headline).toBe('Our custom family headline');
    expect(content.questions.items[0].id).toBe('family-stage');
  });

  it('derives qualification questions and structured reward labels', () => {
    const content = createGuidedReviewTemplate('general_wellness');
    const quiz = guidedReviewToQuiz(content);
    expect(quiz).toMatchObject({ enabled: true, mode: 'qualification' });
    expect(quiz.steps).toHaveLength(3);
    expect(rewardConditionLabel(content.rewards.attendance)).toBe('Attend the review');
    expect(content.rewards.attendance.quantity).toBeGreaterThan(0);
  });

  it('reorders page sections by their drag identifiers', () => {
    const sections = createGuidedReviewTemplate().sections;
    const reordered = reorderGuidedReviewSections(sections, 'rewards', 'audience');
    expect(reordered.map((section) => section.id).slice(0, 4)).toEqual([
      'hero', 'rewards', 'audience', 'problem',
    ]);
    expect(sections[1].id).toBe('audience');
  });

  it('applies AI copy while preserving legal and reward operations', () => {
    const current = createGuidedReviewTemplate('financial_readiness');
    current.trust.partner = 'Approved Advisory Pte. Ltd.';
    current.rewards.attendance.quantity = 42;
    const next = applyGuidedReviewAiDraft(current, {
      templateId: 'prenatal_money_review',
      content: {
        hero: { headline: 'A calmer plan for your growing family.' },
        questions: { items: [{ prompt: 'What would help most?', options: ['Cash flow', 'Protection'] }] },
      },
    });
    expect(next.templateId).toBe('prenatal_money_review');
    expect(next.hero.headline).toContain('growing family');
    expect(next.theme.accent).toBe('#c05f6f');
    expect(next.trust.partner).toBe('Approved Advisory Pte. Ltd.');
    expect(next.rewards.attendance.quantity).toBe(42);
    expect(next.questions.items[0].id).toBe('what-would-help-most');
  });
});
