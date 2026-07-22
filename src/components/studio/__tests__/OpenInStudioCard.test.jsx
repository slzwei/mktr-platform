import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpenInStudioCard from '../OpenInStudioCard';

describe('OpenInStudioCard', () => {
  it('offers the AI fill entry (?ai=full) as the primary action plus the plain Studio link', () => {
    render(
      <MemoryRouter>
        <OpenInStudioCard campaignId="c1" />
      </MemoryRouter>
    );
    expect(screen.getByTestId('studio-ai-fill-link')).toHaveAttribute('href', '/admin/campaigns/c1/studio?ai=full');
    expect(screen.getByRole('link', { name: /Open Campaign Studio/ })).toHaveAttribute('href', '/admin/campaigns/c1/studio');
  });
});
