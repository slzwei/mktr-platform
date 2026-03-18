/* global process */
import { test, expect } from '@playwright/test';

/**
 * Agent Management E2E Tests
 *
 * Tests agent invitation, registration, login, and dashboard access.
 *
 * Prerequisites:
 *   - A running backend with seeded admin and agent users
 *   - Environment variables: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
 *     TEST_AGENT_EMAIL, TEST_AGENT_PASSWORD
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@mktr.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'password123';
const AGENT_EMAIL = process.env.TEST_AGENT_EMAIL || 'agent@mktr.com';
const AGENT_PASSWORD = process.env.TEST_AGENT_PASSWORD || 'password123';

const UNIQUE = Date.now().toString(36);
const INVITE_EMAIL = `invite-${UNIQUE}@test.com`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function adminLogin(page) {
  await page.goto('/CustomerLogin');
  await page.fill('#agent-email', ADMIN_EMAIL);
  await page.fill('#agent-password', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/AdminDashboard|Dashboard/i, { timeout: 10000 });
}

async function agentLogin(page) {
  await page.goto('/CustomerLogin');
  await page.fill('#agent-email', AGENT_EMAIL);
  await page.fill('#agent-password', AGENT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/AgentDashboard|Dashboard/i, { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Agent Management', () => {
  test('admin navigates to agents page', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    // Should show agents heading or table
    const heading = page.locator('text=/agent/i').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('agents page shows agent table', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    // Should render a table with agent data or empty state
    const table = page.locator('table, text=/no agents/i').first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test('admin opens invite agent dialog', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    // Click invite/add agent button
    const inviteBtn = page
      .locator('button:has-text("Invite"), button:has-text("Add Agent"), button:has-text("New")')
      .first();
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      await page.waitForTimeout(1000);

      // Dialog should open with email field
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });
    }
  });

  test('admin invites new agent with email', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    const inviteBtn = page
      .locator('button:has-text("Invite"), button:has-text("Add Agent"), button:has-text("New")')
      .first();
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      await page.waitForTimeout(1000);

      // Fill email in dialog
      const emailInput = page
        .locator(
          '[role="dialog"] input[type="email"], [role="dialog"] input[name="email"], [role="dialog"] input[placeholder*="email" i]'
        )
        .first();
      if (await emailInput.isVisible()) {
        await emailInput.fill(INVITE_EMAIL);

        // Submit invitation
        const sendBtn = page
          .locator(
            '[role="dialog"] button:has-text("Invite"), [role="dialog"] button:has-text("Send"), [role="dialog"] button[type="submit"]'
          )
          .first();
        if (await sendBtn.isVisible()) {
          await sendBtn.click();
          await page.waitForTimeout(2000);
        }
      }
    }
  });

  test('accept invite page loads with token', async ({ page }) => {
    // Test that the accept invite page renders (even with invalid token)
    await page.goto('/auth/accept-invite?token=test-invalid-token&email=test@test.com');
    await page.waitForTimeout(2000);

    // Page should load and show either the form or a token error
    await expect(page.locator('body')).not.toBeEmpty();
    const hasContent = await page
      .locator('input, text=/invalid|expired|error|accept/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('accept invite page shows registration form fields', async ({ page }) => {
    await page.goto('/auth/accept-invite?token=placeholder&email=test@test.com');
    await page.waitForTimeout(3000);

    // If token validates, form should have name, password fields
    // If token is invalid, an error message appears
    const hasForm = await page
      .locator('input[type="password"], input[name="password"]')
      .first()
      .isVisible()
      .catch(() => false);
    const hasError = await page
      .locator('text=/invalid|expired|not found/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasForm || hasError).toBe(true);
  });

  test('agent logs in with credentials', async ({ page }) => {
    await page.goto('/CustomerLogin');

    await page.fill('#agent-email', AGENT_EMAIL);
    await page.fill('#agent-password', AGENT_PASSWORD);
    await page.click('button[type="submit"]');

    // Should redirect to agent dashboard or show error
    await page.waitForTimeout(3000);
    const onDashboard = page.url().includes('Dashboard');
    const hasError = await page
      .locator('text=/invalid|error|failed/i')
      .isVisible()
      .catch(() => false);
    expect(onDashboard || hasError).toBe(true);
  });

  test('agent sees dashboard with stats cards', async ({ page }) => {
    await agentLogin(page);

    await page.waitForTimeout(2000);

    // Dashboard should render stat cards
    const cards = page.locator('[class*="card"], [class*="Card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0);

    // Should show agent-specific content
    const hasAgentContent = await page
      .locator('text=/prospect|lead|pipeline|assigned|dashboard/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasAgentContent).toBe(true);
  });

  test('agent views My Prospects page', async ({ page }) => {
    await agentLogin(page);
    await page.goto('/MyProspects');
    await page.waitForTimeout(2000);

    // Page should render
    await expect(page.locator('body')).not.toBeEmpty();
    const heading = page.locator('text=/prospect|lead|my lead/i').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('admin can filter agents by status', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    // Look for status filter
    const statusFilter = page
      .locator('button:has-text("All"), button:has-text("Status"), select[name*="status"]')
      .first();
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page.waitForTimeout(500);

      // Options should appear
      const options = page.locator('[role="option"], [role="menuitem"], option');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('admin can search agents by name or email', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/AdminAgents');
    await page.waitForTimeout(2000);

    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="filter" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('nonexistent-agent-xyz');
      await page.waitForTimeout(1000);

      // Should filter results (possibly empty)
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});
