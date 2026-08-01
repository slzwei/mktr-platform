import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../guided-review/GuidedReviewDesigner', () => ({
  default: ({ campaign, onSave }) => (
    <div
      data-testid="guided-review-designer"
      data-campaign-id={campaign?.id}
      data-has-onsave={typeof onSave === 'function'}
    />
  ),
}));

import DesignEditor from '../DesignEditor';

describe('DesignEditor — guided_review dispatcher (classic editor deleted)', () => {
  it('mounts GuidedReviewDesigner for guided_review campaigns and forwards props', () => {
    render(<DesignEditor campaign={{ id: 'gr-1', type: 'guided_review' }} onSave={vi.fn()} />);
    const designer = screen.getByTestId('guided-review-designer');
    expect(designer).toBeInTheDocument();
    expect(designer.dataset.campaignId).toBe('gr-1');
    expect(designer.dataset.hasOnsave).toBe('true');
  });

  it('renders nothing for non-guided campaigns — the workspace routes those to Studio', () => {
    const { container } = render(
      <DesignEditor
        campaign={{ id: 'c1', type: 'lead_generation', design_config: { formHeadline: 'Hi' } }}
        onSave={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a v2-doc campaign (Studio-owned; the backend 409s classic writes regardless)', () => {
    const { container } = render(
      <DesignEditor
        campaign={{
          id: 'c2',
          type: 'lead_generation',
          design_config: { version: 2, template: { id: 'editorial', params: {} }, content: {}, form: {} },
        }}
        onSave={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
