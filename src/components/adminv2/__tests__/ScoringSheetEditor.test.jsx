/**
 * The curated controls (campaign-scoring-editor §3.1): sign-fixed weight
 * inputs with house ghosts + per-knob reset, the band presets building
 * slope-legal curves, and vocabulary-clamped target segments.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScoringSheetEditor from '../ScoringSheetEditor';
import { buildAgeCurveFromBands } from '@/lib/adminV2/scoringLabels';

const HOUSE = {
  components: {
    engagement: { maxPoints: 15 }, contactability: { maxPoints: 10 }, market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 }, family_gap: { maxPoints: 20 }, capacity: { maxPoints: 15 },
    age: { maxPoints: 10 }, coverage_headroom: { maxPoints: -10 },
  },
  leadComponents: { response: { maxPoints: 15 }, screening: { maxPoints: 20 } },
};

const DOC = {
  components: { ...HOUSE.components, age: { maxPoints: 6 } },
  leadComponents: { ...HOUSE.leadComponents },
  ageCurve: [{ upTo: 44, value: 1 }, { upTo: null, value: 0.5 }],
  targetSegments: [],
  _ageBands: [],
};

function setup(onChange = vi.fn()) {
  render(<ScoringSheetEditor doc={DOC} houseDefault={HOUSE} onChange={onChange} />);
  return onChange;
}

describe('weights', () => {
  it('shows every exposed component with its house ghost, in card language', () => {
    setup();
    expect(screen.getByLabelText('message response weight')).toBeInTheDocument();
    expect(screen.getByLabelText('screening call weight')).toBeInTheDocument();
    expect(screen.getByLabelText('coverage headroom weight')).toBeInTheDocument();
    // The overridden knob offers a reset that pins the house value.
    expect(screen.getByRole('button', { name: 'reset' })).toBeInTheDocument();
  });

  it('a penalty clamps to its own side of zero — it can never be typed positive', () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText('coverage headroom weight'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.objectContaining({ coverage_headroom: { maxPoints: 0 } }),
    }));
  });

  it('a lead-grain weight lands in leadComponents, not components', () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText('screening call weight'), { target: { value: '25' } });
    const doc = onChange.mock.calls[0][0];
    expect(doc.leadComponents.screening.maxPoints).toBe(25);
    expect(doc.components.screening).toBeUndefined();
  });

  it('reset pins the house value explicitly', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.objectContaining({ age: { maxPoints: 10 } }),
    }));
  });
});

describe('the age dial', () => {
  it('a band preset regenerates the curve via the slope-legal ladder', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('button', { name: '30-44' }));
    const doc = onChange.mock.calls[0][0];
    expect(doc.ageCurve).toEqual(buildAgeCurveFromBands(['30-44']));
    expect(doc._ageBands).toEqual(['30-44']);
    // The ladder ramps — no jump exceeds the validator's 0.5 cap.
    for (let i = 1; i < doc.ageCurve.length; i += 1) {
      expect(Math.abs(doc.ageCurve[i].value - doc.ageCurve[i - 1].value)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('target segments', () => {
  it('adds rows up to the cap with vocabulary-only options', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ target segment' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      targetSegments: [{ language: 'en', weight: 1 }],
    }));
  });
});
