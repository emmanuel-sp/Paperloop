import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('saved layered suites remain inspectable across viewports with assisted setup unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  const projectResponse = await page.request.post('/api/v1/projects', { data: { name: 'Layered suite review', description: 'Review a layered evaluation', objectives: [], constraints: [] } });
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  const suite = JSON.parse(readFileSync('docs/evaluation-design/examples/application.json', 'utf8'));
  const draft = await page.request.post(`/api/v1/projects/${project.id}/evaluations`, { data: suite });
  expect(draft.ok()).toBe(true);
  expect((await draft.json()).approvedAt).toBeNull();
  for (const [width, height] of [[360, 844], [390, 844], [768, 900], [1024, 768], [1440, 1000], [900, 500]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/projects/${project.id}/experiments?view=evaluation`);
    const dialog = page.getByRole('dialog', { name: 'Evaluation', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: suite.name })).toBeVisible();
    await expect(dialog.getByText('Layered Evaluation setup is not available in this screen yet. You can inspect this saved suite.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Approve version/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Continue to implementation' })).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByText('Layered Evaluation setup is not available in this screen yet. You can inspect this saved suite.', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `test-results/evaluation-suites/review-${width}x${height}.png` });
    await dialog.getByText('Exact configuration and fingerprint', { exact: true }).click();
    const exact = dialog.locator('pre');
    await exact.scrollIntoViewIfNeeded();
    await expect(exact).toContainText('"formatVersion": 2');
    await expect(exact).toContainText('benchmark:checkout');
    await page.screenshot({ path: `test-results/evaluation-suites/exact-${width}x${height}.png` });
  }
  expect(errors).toEqual([]);
});
