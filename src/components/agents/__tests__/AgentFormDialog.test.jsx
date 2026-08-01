import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentFormDialog from '@/components/agents/AgentFormDialog';

// Mock zod resolver
vi.mock('@hookform/resolvers/zod', () => ({
 zodResolver: () => () => ({ values: {}, errors: {} }),
}));

describe('AgentFormDialog', () => {
 const defaultProps = {
 open: true,
 onOpenChange: vi.fn(),
 agent: null,
 onSubmit: vi.fn(),
 };

 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders the dialog when open', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByText('Invite New Agent')).toBeInTheDocument();
 });

 it('renders"Edit Agent" title when agent is provided', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'test@test.com', fullName: 'Test Agent' }} />);
 expect(screen.getByText('Edit Agent')).toBeInTheDocument();
 });

 it('renders full name input', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument();
 });

 it('renders email input', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByLabelText(/Email Address/)).toBeInTheDocument();
 });

 it('renders"Send Invite" button for new agent', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByText('Send Invite')).toBeInTheDocument();
 });

 it('renders"Save Agent" button for editing', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'a@b.com', fullName: 'A B' }} />);
 expect(screen.getByText('Save Agent')).toBeInTheDocument();
 });

 it('renders Cancel button', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByText('Cancel')).toBeInTheDocument();
 });

 it('calls onOpenChange(false) when Cancel is clicked', () => {
 const onOpenChange = vi.fn();
 render(<AgentFormDialog {...defaultProps} onOpenChange={onOpenChange} />);
 fireEvent.click(screen.getByText('Cancel'));
 expect(onOpenChange).toHaveBeenCalledWith(false);
 });

 it('shows phone field when editing an existing agent', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'a@b.com', fullName: 'Agent', phone: '91234567' }} />);
 expect(screen.getByLabelText(/Phone Number/)).toBeInTheDocument();
 });

 it('does not show phone field for new agent invite', () => {
 render(<AgentFormDialog {...defaultProps} agent={null} />);
 expect(screen.queryByLabelText(/Phone Number/)).not.toBeInTheDocument();
 });

 it('shows date of birth field when editing', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'a@b.com', fullName: 'Agent' }} />);
 expect(screen.getByLabelText(/Date of Birth/)).toBeInTheDocument();
 });

 it('pre-fills name when editing', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'a@b.com', fullName: 'John Doe' }} />);
 const nameInput = screen.getByLabelText(/Full Name/);
 expect(nameInput.value).toBe('John Doe');
 });

 it('pre-fills email when editing', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'john@test.com', fullName: 'John' }} />);
 const emailInput = screen.getByLabelText(/Email Address/);
 expect(emailInput.value).toBe('john@test.com');
 });

 it('does not render when closed', () => {
 render(<AgentFormDialog {...defaultProps} open={false} />);
 expect(screen.queryByText('Invite New Agent')).not.toBeInTheDocument();
 });

 it('renders invite description for new agent', () => {
 render(<AgentFormDialog {...defaultProps} />);
 expect(screen.getByText(/invite a new agent/i)).toBeInTheDocument();
 });

 it('renders edit description for existing agent', () => {
 render(<AgentFormDialog {...defaultProps} agent={{ email: 'a@b.com', fullName: 'Test' }} />);
 expect(screen.getByText(/Update the agent/i)).toBeInTheDocument();
 });
});
