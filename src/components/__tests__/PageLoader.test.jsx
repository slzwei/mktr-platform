import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PageLoader } from '../PageLoader';

describe('PageLoader', () => {
 it('renders with the default"Loading..." message', () => {
 render(<PageLoader />);
 expect(screen.getByText('Loading...')).toBeInTheDocument();
 });

 it('renders with a custom message', () => {
 render(<PageLoader message="Fetching prospects..." />);
 expect(screen.getByText('Fetching prospects...')).toBeInTheDocument();
 expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
 });

 it('contains an SVG spinner icon', () => {
 const { container } = render(<PageLoader />);
 const svg = container.querySelector('svg');
 expect(svg).toBeTruthy();
 // Lucide Loader2 has the animate-spin class
 expect(svg.className.baseVal || svg.getAttribute('class') || '').toMatch(/animate-spin/);
 });
});
