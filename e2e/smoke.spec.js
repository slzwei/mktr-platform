import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('homepage loads and shows MKTR branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MKTR/i);
    await expect(page.locator('text=MKTR')).toBeVisible();
  });

  test('login page renders with email and password fields', async ({ page }) => {
    await page.goto('/CustomerLogin');
    await expect(page.locator('input[type="email"], input[id*="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"], input[id*="password"]')).toBeVisible();
  });

  test('unauthenticated access to dashboard redirects to login', async ({ page }) => {
    await page.goto('/AdminDashboard');
    // Should redirect to login page
    await page.waitForURL(/CustomerLogin|Login/i, { timeout: 5000 });
    await expect(page.locator('input[type="email"], input[id*="email"]')).toBeVisible();
  });

  test('lead capture page loads', async ({ page }) => {
    await page.goto('/LeadCapture');
    // Should show some form or campaign content
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
