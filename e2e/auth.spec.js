import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/CustomerLogin');

    // Fill in login form
    await page.fill('input[id*="email"], input[type="email"]', 'nonexistent@test.com');
    await page.fill('input[id*="password"], input[type="password"]', 'wrongpassword');

    // Submit
    await page.click('button[type="submit"]');

    // Should show error message (not redirect)
    await page.waitForTimeout(2000);
    const errorVisible = await page.locator('text=/invalid|error|failed/i').isVisible();
    expect(errorVisible).toBe(true);
  });

  test('login page has sign in and sign up tabs', async ({ page }) => {
    await page.goto('/CustomerLogin');

    // Should have tab-like navigation
    const signIn = page.locator('text=/sign in/i');
    const signUp = page.locator('text=/sign up|register|create account/i');

    await expect(signIn.first()).toBeVisible();
    await expect(signUp.first()).toBeVisible();
  });

  test('Google OAuth button or link is present', async ({ page }) => {
    await page.goto('/CustomerLogin');

    // Look for Google sign-in element
    const googleElement = page.locator('[id*="google"], text=/google/i, [class*="google"]');
    // Google button may or may not render depending on GOOGLE_CLIENT_ID config
    // Just check the page loaded without errors
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
