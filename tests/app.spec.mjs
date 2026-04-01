import { test, expect } from '@playwright/test';

test.describe('Fuel Price App', () => {

  test('should load and display the page title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/[Cc]eny paliw/);
    await expect(page.locator('h1')).toContainText('Ceny paliw');
  });

  test('should display price cards with fuel data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const cards = page.locator('.price-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Active card should have prices
    const activeCard = page.locator('.price-card--active');
    await expect(activeCard).toHaveCount(1);
    await expect(activeCard).toContainText('PB95');
    await expect(activeCard).toContainText('PB98');
    await expect(activeCard).toContainText('ON');
    await expect(activeCard).toContainText('zł/l');
  });

  test('should navigate with prev/next carousel buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const prevBtn = page.locator('#prevDay');
    const nextBtn = page.locator('#nextDay');

    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();

    // Click next — should navigate or be disabled
    await nextBtn.click();
    await page.waitForTimeout(200);

    // Active card should still exist
    await expect(page.locator('.price-card--active')).toHaveCount(1);
  });

  test('should navigate with keyboard arrows', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);

    await expect(page.locator('.price-card--active')).toHaveCount(1);
  });

  test('should open chart in modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chartToggle', { timeout: 5000 });

    // Modal should be hidden initially
    const modal = page.locator('#chartModal');
    await expect(modal).toBeHidden();

    // Click to open chart modal
    await page.locator('#chartToggle').click();
    await expect(modal).toBeVisible();

    // Canvas should be visible inside modal
    await expect(page.locator('#priceChart')).toBeVisible();

    // Close button should work
    await page.locator('#chartModalClose').click();
    await expect(modal).toBeHidden();
  });

  test('should close chart modal with Escape key', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chartToggle', { timeout: 5000 });

    await page.locator('#chartToggle').click();
    await expect(page.locator('#chartModal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#chartModal')).toBeHidden();
  });

  test('should close chart modal by clicking overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chartToggle', { timeout: 5000 });

    await page.locator('#chartToggle').click();
    const modal = page.locator('#chartModal');
    await expect(modal).toBeVisible();

    // Click on the overlay (not the content)
    await modal.click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden();
  });

  test('should display last updated in footer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#lastUpdated', { timeout: 5000 });

    const lastUpdated = page.locator('#lastUpdated');
    await expect(lastUpdated).toContainText('Aktualizacja');
  });

  test('should show staleness dot in footer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#stalenessDot', { timeout: 5000 });

    const dot = page.locator('#stalenessDot');
    await expect(dot).toBeVisible();
    const className = await dot.getAttribute('class');
    expect(className).toMatch(/staleness-dot--(fresh|stale|old)/);
  });

  test('should have proper ARIA attributes on carousel', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#carousel', { timeout: 5000 });

    const carousel = page.locator('#carousel');
    await expect(carousel).toHaveAttribute('role', 'region');
    await expect(carousel).toHaveAttribute('aria-label', 'Karuzela cen paliw');
  });

  test('should have CSP meta tag', async ({ page }) => {
    await page.goto('/');
    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(csp).toHaveCount(1);
  });

  test('should show only one card on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    // On mobile, inactive cards are hidden with display:none
    const visibleCards = page.locator('.price-card:visible');
    const count = await visibleCards.count();
    expect(count).toBeLessThanOrEqual(1);
  });

  test('should click on inactive card to activate it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const inactiveCards = page.locator('.price-card--inactive');
    const count = await inactiveCards.count();

    if (count > 0) {
      const targetDate = await inactiveCards.first().getAttribute('data-date');
      await inactiveCards.first().click();

      const activeCard = page.locator('.price-card--active');
      await expect(activeCard).toHaveAttribute('data-date', targetDate);
    }
  });

  test('should render chart with canvas element', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chartToggle', { timeout: 5000 });

    await page.locator('#chartToggle').click();
    await page.waitForSelector('#priceChart', { timeout: 5000 });

    const canvas = page.locator('#priceChart');
    await expect(canvas).toBeVisible();
  });

  test('should show source link on price card', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const sourceLinks = page.locator('.price-card__source a');
    const count = await sourceLinks.count();

    if (count > 0) {
      const href = await sourceLinks.first().getAttribute('href');
      expect(href).toMatch(/^https:\/\//);
      await expect(sourceLinks.first()).toContainText('źródło');
    }
  });

  test('should show unknown card for missing tomorrow data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    // Navigate to find the unknown card (at the end of entries)
    // Keep pressing next until we can't anymore
    const nextBtn = page.locator('#nextDay');
    for (let i = 0; i < 10; i++) {
      const disabled = await nextBtn.isDisabled();
      if (disabled) break;
      await nextBtn.click();
      await page.waitForTimeout(100);
    }

    // The last card shown should be the unknown card (if tomorrow data is missing)
    const unknownCards = page.locator('.price-card--unknown');
    const count = await unknownCards.count();
    if (count > 0) {
      await expect(unknownCards.first()).toContainText('Brak danych');
    }
  });

  test('should have theme toggle button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#themeToggle', { timeout: 5000 });

    const toggle = page.locator('#themeToggle');
    await expect(toggle).toBeVisible();

    await toggle.click();
    const theme = await page.locator('body').getAttribute('data-theme');
    expect(['auto', 'dark', 'light']).toContain(theme);
  });

  test('should cycle through themes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#themeToggle', { timeout: 5000 });

    const toggle = page.locator('#themeToggle');

    // Default is auto → dark → light → auto
    await toggle.click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');

    await toggle.click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');

    await toggle.click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'auto');
  });

  test('should have PWA manifest link', async ({ page }) => {
    await page.goto('/');
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveAttribute('href', 'manifest.json');
  });

  test('should have proper theme-color meta tag', async ({ page }) => {
    await page.goto('/');
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveAttribute('content', '#000000');
  });

  test('should render 404 page', async ({ page }) => {
    await page.goto('/404.html');
    await expect(page).toHaveTitle(/404|Nie znaleziono/);
    await expect(page.locator('body')).toContainText('404');
  });

  test('should have proper description meta tag', async ({ page }) => {
    await page.goto('/');
    const meta = page.locator('meta[name="description"]');
    await expect(meta).toHaveAttribute('content', /ceny|paliw/i);
  });

  test('should have SEO meta tags', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:type"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  });

  test('should not have horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test('should support touch interaction on carousel', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForSelector('.price-card', { timeout: 5000 });

    const track = page.locator('#carouselTrack');
    const box = await track.boundingBox();
    if (box) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }

    await expect(page.locator('.price-card--active')).toHaveCount(1);
    await context.close();
  });
});
