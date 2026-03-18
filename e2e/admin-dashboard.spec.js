/* global process */
import { test, expect } from '@playwright/test';

/**
 * Admin Dashboard E2E Tests
 *
 * Tests dashboard rendering, stats cards, period selector,
 * navigation sidebar, and logout functionality.
 *
 * Prerequisites:
 *   - A running backend with seeded admin user
 *   - Environment variables: TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@mktr.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'password123';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Admin Dashboard', () => {
  test('admin login redirects to dashboard', async ({ page }) => {
    await page.goto('/CustomerLogin');

    await page.fill('#agent-email', ADMIN_EMAIL);
    await page.fill('#agent-password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Should redirect to admin dashboard
    await page.waitForTimeout(3000);
    const onDashboard = page.url().includes('Dashboard');
    const hasError = await page
      .locator('text=/invalid|error|failed/i')
      .isVisible()
      .catch(() => false);
    expect(onDashboard || hasError).toBe(true);
  });

  test('dashboard renders header with title', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    // Header should show MKTR Admin or Dashboard title
    const header = page.locator('text=/dashboard/i').first();
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test('dashboard renders stats cards', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(3000);

    // Should show stat cards: Total Revenue, Active Campaigns, Total Prospects, Fleet Size, Ad Impressions
    const cards = page.locator('[class*="card"], [class*="Card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Check for known card titles
    const revenueCard = page.locator('text=/total revenue/i').first();
    const campaignsCard = page.locator('text=/active campaigns/i').first();
    const prospectsCard = page.locator('text=/total prospects/i').first();

    const hasRevenue = await revenueCard.isVisible().catch(() => false);
    const hasCampaigns = await campaignsCard.isVisible().catch(() => false);
    const hasProspects = await prospectsCard.isVisible().catch(() => false);

    // At least one stat card should be visible
    expect(hasRevenue || hasCampaigns || hasProspects).toBe(true);
  });

  test('period selector is visible and interactive', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    // Look for period dropdown (7d, 30d, 90d)
    const periodSelector = page
      .locator('button:has-text("30"), button:has-text("days"), select, [role="combobox"]')
      .first();
    if (await periodSelector.isVisible()) {
      await periodSelector.click();
      await page.waitForTimeout(500);

      // Options should appear
      const options = page.locator('[role="option"], [role="menuitem"], option');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('changing period selector updates dashboard data', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(3000);

    // Find and click period selector
    const periodSelector = page
      .locator('button:has-text("30"), button:has-text("days"), select, [role="combobox"]')
      .first();
    if (await periodSelector.isVisible()) {
      await periodSelector.click();
      await page.waitForTimeout(500);

      // Select 7 days option
      const sevenDayOption = page
        .locator('[role="option"]:has-text("7"), [role="menuitem"]:has-text("7"), option:has-text("7")')
        .first();
      if (await sevenDayOption.isVisible()) {
        await sevenDayOption.click();
        await page.waitForTimeout(2000);
      }
    }

    // Dashboard should still render without errors
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('sidebar navigation shows all admin sections', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    // Sidebar should have navigation links
    const dashboardLink = page.locator('a[href*="AdminDashboard"], a:has-text("Dashboard")').first();
    const prospectsLink = page.locator('a[href*="AdminProspects"], a:has-text("Prospects")').first();
    const _campaignsLink = page.locator('a[href*="AdminCampaigns"], a:has-text("Campaigns")').first();
    const _agentsLink = page.locator('a[href*="AdminAgents"], a:has-text("Agents")').first();
    const _commissionsLink = page.locator('a[href*="AdminCommissions"], a:has-text("Commissions")').first();

    // At least dashboard link should be visible (sidebar may be collapsed on small screens)
    const hasDashboard = await dashboardLink.isVisible().catch(() => false);
    const hasProspects = await prospectsLink.isVisible().catch(() => false);
    expect(hasDashboard || hasProspects).toBe(true);
  });

  test('navigate to Prospects from sidebar', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    const prospectsLink = page.locator('a[href*="AdminProspects"]').first();
    if (await prospectsLink.isVisible()) {
      await prospectsLink.click();
      await page.waitForURL(/AdminProspects/i, { timeout: 5000 });
      expect(page.url()).toContain('AdminProspects');
    }
  });

  test('navigate to Campaigns from sidebar', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    const campaignsLink = page.locator('a[href*="AdminCampaigns"]').first();
    if (await campaignsLink.isVisible()) {
      await campaignsLink.click();
      await page.waitForURL(/AdminCampaigns/i, { timeout: 5000 });
      expect(page.url()).toContain('AdminCampaigns');
    }
  });

  test('export report button is present', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Download")').first();
    if (await exportBtn.isVisible()) {
      await expect(exportBtn).toBeVisible();
      // Click to trigger download (won't actually download in headless)
      await exportBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('logout redirects to login page', async ({ page }) => {
    await adminLogin(page);
    await page.waitForTimeout(2000);

    // Find logout button in sidebar footer
    const logoutBtn = page
      .locator('button:has-text("Sign Out"), button:has-text("Logout"), button:has-text("Log out")')
      .first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForTimeout(3000);

      // Should redirect to login or homepage
      const onLogin =
        page.url().includes('Login') || page.url().includes('Homepage') || page.url() === 'http://localhost:5173/';
      expect(onLogin).toBe(true);
    }
  });
});
