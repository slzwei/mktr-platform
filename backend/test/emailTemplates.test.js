import './setup.js'
import {
  getAgentInviteSubject,
  getAgentInviteEmail,
  getAgentInviteText,
  getRoleInviteSubject,
  getRoleInviteEmail,
  getRoleInviteText
} from '../src/services/emailTemplates.js'

// ─────────────────────────────────────────────────────────────────────────────
// Agent Invite Templates
// ─────────────────────────────────────────────────────────────────────────────

describe('getAgentInviteSubject', () => {
  it('returns subject with default company name', () => {
    const subject = getAgentInviteSubject()
    expect(subject).toBe('You are invited to join MKTR as an Agent')
  })

  it('returns subject with custom company name', () => {
    const subject = getAgentInviteSubject('Acme Corp')
    expect(subject).toBe('You are invited to join Acme Corp as an Agent')
  })
})

describe('getAgentInviteEmail', () => {
  const validParams = {
    firstName: 'Alice',
    inviteLink: 'https://app.example.com/invite/abc123',
    companyName: 'TestCo',
    companyUrl: 'https://testco.com',
    expiryDays: 14
  }

  it('returns valid HTML containing doctype', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('</html>')
  })

  it('includes firstName in greeting', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('Hi Alice,')
  })

  it('includes invite link in CTA button and linkbox', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('href="https://app.example.com/invite/abc123"')
    // Linkbox also shows the raw link
    expect(html).toContain('https://app.example.com/invite/abc123')
  })

  it('includes company name in header and body', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('TestCo')
    expect(html).toContain('join <strong>TestCo</strong>')
  })

  it('includes company URL in footer', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('href="https://testco.com"')
  })

  it('includes expiry days', () => {
    const html = getAgentInviteEmail(validParams)
    expect(html).toContain('14 days')
  })

  it('uses default firstName "there" when not provided', () => {
    const html = getAgentInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('Hi there,')
  })

  it('uses default companyName "MKTR" when not provided', () => {
    const html = getAgentInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('MKTR')
  })

  it('uses default companyUrl when not provided', () => {
    const html = getAgentInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('href="https://example.com"')
  })

  it('uses default expiryDays of 7 when not provided', () => {
    const html = getAgentInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('7 days')
  })

  it('handles null/undefined inviteLink gracefully', () => {
    const html = getAgentInviteEmail({ firstName: 'Bob', inviteLink: null })
    // Should not throw; link becomes empty string
    expect(html).toContain('Hi Bob,')
    expect(html).toContain('<!doctype html>')
  })

  it('handles special characters in firstName', () => {
    const html = getAgentInviteEmail({
      firstName: 'O\'Brien & "Mac"',
      inviteLink: 'https://example.com/invite'
    })
    expect(html).toContain('O\'Brien & "Mac"')
  })

  it('handles special characters in companyName', () => {
    const html = getAgentInviteEmail({
      companyName: 'AT&T <Corp>',
      inviteLink: 'https://example.com/invite'
    })
    expect(html).toContain('AT&T <Corp>')
  })

  it('trims whitespace from inviteLink', () => {
    const html = getAgentInviteEmail({
      inviteLink: '  https://example.com/invite  '
    })
    expect(html).toContain('href="https://example.com/invite"')
  })
})

describe('getAgentInviteText', () => {
  it('returns plain-text email with all fields', () => {
    const text = getAgentInviteText({
      firstName: 'Charlie',
      inviteLink: 'https://example.com/invite/xyz',
      companyName: 'TestCo',
      expiryDays: 5
    })

    expect(text).toContain('Hi Charlie,')
    expect(text).toContain('join TestCo')
    expect(text).toContain('https://example.com/invite/xyz')
    expect(text).toContain('5 days')
  })

  it('uses defaults for missing fields', () => {
    const text = getAgentInviteText({ inviteLink: 'https://link.test' })
    expect(text).toContain('Hi there,')
    expect(text).toContain('MKTR')
    expect(text).toContain('7 days')
  })

  it('contains newlines for proper formatting', () => {
    const text = getAgentInviteText({ inviteLink: 'https://example.com' })
    expect(text).toContain('\n')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Generic Role Invite Templates
// ─────────────────────────────────────────────────────────────────────────────

describe('getRoleInviteSubject', () => {
  it('returns subject with defaults', () => {
    const subject = getRoleInviteSubject()
    expect(subject).toBe('You are invited to join MKTR as a User')
  })

  it('returns subject with custom role and company', () => {
    const subject = getRoleInviteSubject({ companyName: 'Acme', roleLabel: 'Fleet Manager' })
    expect(subject).toBe('You are invited to join Acme as a Fleet Manager')
  })
})

describe('getRoleInviteEmail', () => {
  const validParams = {
    firstName: 'Diana',
    inviteLink: 'https://app.example.com/invite/role123',
    companyName: 'RoleCo',
    companyUrl: 'https://roleco.com',
    expiryDays: 10,
    roleLabel: 'Fleet Manager'
  }

  it('returns valid HTML', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('</html>')
  })

  it('includes roleLabel in body text', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('<strong>Fleet Manager</strong>')
  })

  it('includes roleLabel in page title', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('<title>RoleCo Fleet Manager Invitation</title>')
  })

  it('includes firstName in greeting', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('Hi Diana,')
  })

  it('includes invite link', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('href="https://app.example.com/invite/role123"')
  })

  it('includes expiry days', () => {
    const html = getRoleInviteEmail(validParams)
    expect(html).toContain('10 days')
  })

  it('uses default roleLabel "User" when not provided', () => {
    const html = getRoleInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('<strong>User</strong>')
  })

  it('uses default companyUrl when not provided', () => {
    const html = getRoleInviteEmail({ inviteLink: 'https://example.com/invite' })
    expect(html).toContain('href="https://example.com"')
  })

  it('handles null inviteLink gracefully', () => {
    const html = getRoleInviteEmail({ inviteLink: undefined })
    expect(html).toContain('<!doctype html>')
  })

  it('handles special characters in roleLabel', () => {
    const html = getRoleInviteEmail({
      roleLabel: 'Admin & "Super User"',
      inviteLink: 'https://example.com'
    })
    expect(html).toContain('Admin & "Super User"')
  })
})

describe('getRoleInviteText', () => {
  it('returns plain-text email with role label', () => {
    const text = getRoleInviteText({
      firstName: 'Eve',
      inviteLink: 'https://example.com/role',
      companyName: 'TestCo',
      expiryDays: 3,
      roleLabel: 'Driver'
    })

    expect(text).toContain('Hi Eve,')
    expect(text).toContain('join TestCo as a Driver')
    expect(text).toContain('https://example.com/role')
    expect(text).toContain('3 days')
  })

  it('uses defaults for all missing fields', () => {
    const text = getRoleInviteText({ inviteLink: 'https://example.com' })
    expect(text).toContain('Hi there,')
    expect(text).toContain('MKTR')
    expect(text).toContain('as a User')
    expect(text).toContain('7 days')
  })
})
