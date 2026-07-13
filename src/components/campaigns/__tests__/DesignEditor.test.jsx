import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), baseURL: 'http://localhost/api' },
}));
vi.mock('@/api/integrations', () => ({ UploadFile: vi.fn() }));

import DesignEditor from '@/components/campaigns/DesignEditor';

const campaign = { id: 'camp-1', name: 'Test Campaign', design_config: { formHeadline: 'Hi' } };

describe('DesignEditor — save failure keeps the dirty state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not clear unsaved changes or show "Saved" when onSave rejects', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));
    render(<DesignEditor campaign={campaign} onSave={onSave} />);

    // Make an edit so the design becomes dirty.
    const headline = screen.getByPlaceholderText('e.g., Get Started Now!');
    await user.type(headline, '!');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Attempt to save — onSave rejects.
    await user.click(screen.getByRole('button', { name: /Save Design/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    // Dirty state must survive a failed save; the false "Saved" must not appear.
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('clears the dirty state and shows "Saved" when onSave resolves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);

    const headline = screen.getByPlaceholderText('e.g., Get Started Now!');
    await user.type(headline, '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
});

describe('DesignEditor — SG/PR only toggle persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the SG/PR only toggle, off by default', () => {
    render(<DesignEditor campaign={campaign} onSave={vi.fn()} />);
    expect(screen.getByText('SG / PR only')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'SG / PR only' })).not.toBeChecked();
  });

  it('persists sgPrOnly:false when the toggle is left off', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    // Dirty the design without touching the toggle.
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: false });
  });

  it('persists sgPrOnly:true after switching it on', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    await user.click(screen.getByRole('switch', { name: 'SG / PR only' }));
    expect(screen.getByRole('switch', { name: 'SG / PR only' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: true });
  });

  it('initializes the toggle ON for a campaign with sgPrOnly:true and preserves it on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const gated = { id: 'camp-2', name: 'Gated', design_config: { formHeadline: 'Hi', sgPrOnly: true } };
    render(<DesignEditor campaign={gated} onSave={onSave} />);
    expect(screen.getByRole('switch', { name: 'SG / PR only' })).toBeChecked();
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ sgPrOnly: true });
  });
});

describe('DesignEditor — exclude financial consultants toggle persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the exclude-consultants toggle, off by default', () => {
    render(<DesignEditor campaign={campaign} onSave={vi.fn()} />);
    expect(screen.getByText('Exclude financial consultants')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exclude financial consultants' })).not.toBeChecked();
  });

  it('persists excludeAdvisors:false when the toggle is left off', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ excludeAdvisors: false });
  });

  it('persists excludeAdvisors:true after switching it on', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DesignEditor campaign={campaign} onSave={onSave} />);
    await user.click(screen.getByRole('switch', { name: 'Exclude financial consultants' }));
    expect(screen.getByRole('switch', { name: 'Exclude financial consultants' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ excludeAdvisors: true });
  });

  it('initializes ON for a campaign with excludeAdvisors:true and preserves it on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const gated = { id: 'camp-3', name: 'NoAdvisors', design_config: { formHeadline: 'Hi', excludeAdvisors: true } };
    render(<DesignEditor campaign={gated} onSave={onSave} />);
    expect(screen.getByRole('switch', { name: 'Exclude financial consultants' })).toBeChecked();
    await user.type(screen.getByPlaceholderText('e.g., Get Started Now!'), '!');
    await user.click(screen.getByRole('button', { name: /Save Design/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ excludeAdvisors: true });
  });
});

describe('DesignEditor — Guided Review format', () => {
  it('opens the Squarespace-style section canvas for guided review campaigns', () => {
    render(
      <DesignEditor
        campaign={{ id: 'review-1', name: 'Retirement Review', type: 'guided_review', design_config: {} }}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText('Page sections')).toBeInTheDocument();
    expect(screen.getByText('Live page canvas')).toBeInTheDocument();
    expect(screen.getByText('Site styles')).toBeInTheDocument();
    expect(screen.getByText('What happens in the review.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Drag .* section$/ })).toHaveLength(9);
  });

  it('saves Guided Review content and derives a qualification quiz', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <DesignEditor
        campaign={{ id: 'review-2', name: 'Retirement Review', type: 'guided_review', design_config: {} }}
        onSave={onSave}
      />
    );

    const headline = screen.getByDisplayValue('Know where your money stands.');
    await user.clear(headline);
    await user.type(headline, 'Plan the years ahead.');
    await user.click(screen.getByRole('button', { name: /Save page/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      guidedReview: {
        templateId: 'financial_readiness',
        hero: { headline: 'Plan the years ahead.' },
        rewards: { grand: { conditionKey: 'submission', quantity: 1 } },
      },
      quiz: { enabled: true, mode: 'qualification' },
      sgPrOnly: true,
    });
  });

  it('applies a selected template only after confirmation and preserves trust details', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <DesignEditor
        campaign={{
          id: 'review-3',
          name: 'Family Review',
          type: 'guided_review',
          design_config: { guidedReview: { trust: { partner: 'Example Advisory Pte. Ltd.' } } },
        }}
        onSave={onSave}
      />
    );

    screen.getByRole('combobox', { name: 'Guided Review template' }).focus();
    await user.keyboard('[ArrowDown][ArrowDown][Enter]');
    expect(screen.getByDisplayValue('Know where your money stands.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply template' }));
    expect(screen.getByDisplayValue('Make room for baby—and the life around them.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save page/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      guidedReview: {
        templateId: 'prenatal_money_review',
        theme: { accent: '#c05f6f', ink: '#3b3038', paper: '#fff3f0', sage: '#7e8f83' },
        trust: { partner: 'Example Advisory Pte. Ltd.' },
        questions: { items: [{ id: 'family-stage' }, expect.anything(), expect.anything()] },
      },
    });
  });
});
