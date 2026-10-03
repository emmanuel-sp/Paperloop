import { test, expect } from '@playwright/test';

test('shared populated scenarios support persisted decisions, evidence and responsive review', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  const seeded = await page.request.post('/__test/scenarios');
  expect(seeded.ok()).toBe(true);
  const manifest = await seeded.json();
  const projectId = manifest.projects.find((value: { key: string }) => value.key === 'busy').id;
  const base = `/projects/${projectId}`;
  await page.goto(`${base}/research`);
  const cards = page.locator('.recommendation-card');
  const first = cards.first();
  const title = await first.getByRole('heading', { level: 3 }).textContent();
  await first.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.reload();
  await expect(cards.filter({ hasText: title! })).toHaveCount(0);
  await page.getByRole('button', { name: 'Past decisions & context', exact: true }).click();
  await expect(cards.filter({ hasText: title! })).toContainText('Rejected');
  const history = await page.request.get(`/api/v1/projects/${projectId}/recommendations?view=history`);
  expect(history.ok()).toBe(true);
  expect((await history.json()).recommendations.some((value: { state: string; proposal: { title: string } }) => value.proposal.title === title && value.state === 'dismissed')).toBe(true);

  const measured = manifest.measurements[0];
  await page.goto(`${base}/experiments?experiment=${measured.experimentId}`);
  await expect(page.getByRole('heading', { name: 'Improvement measured' })).toBeVisible();
  const artifact = await page.request.get(`/api/v1/runs/${measured.candidateRunId}/artifacts/artifact-0`);
  expect(artifact.ok()).toBe(true);
  expect(JSON.parse((await artifact.json()).content).cases).toHaveLength(300);

  for (const [width, height] of [[360, 844], [390, 844], [768, 900], [1024, 768], [1440, 1000], [900, 500]]) {
    await page.setViewportSize({ width, height });
    for (const section of ['overview', 'research', 'experiments', 'schedules', 'settings']) {
      await page.goto(`${base}/${section}`);
      await expect(page.getByRole('heading', { name: new RegExp(`^${section}$`, 'i'), level: 1 })).toBeVisible();
      if (section === 'schedules') await expect(page.getByRole('alert')).toHaveText('Synthetic setup failure: no native scheduler was invoked.');
      else await expect(page.getByRole('alert')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/scenarios/${section}-${width}x${height}.png`, fullPage: true });
    }
    await page.goto(`${base}/experiments?view=evaluation`);
    const evaluation = page.getByRole('dialog', { name: 'Evaluation', exact: true });
    await expect(evaluation).toBeVisible();
    await evaluation.getByRole('button', { name: 'Define custom Evaluation', exact: true }).click();
    const custom = page.getByRole('dialog', { name: 'Define custom Evaluation', exact: true });
    await expect(custom).toBeVisible();
    await page.screenshot({ path: `test-results/scenarios/custom-evaluation-${width}x${height}.png`, fullPage: true });
    const save = custom.getByRole('button', { name: 'Save new Evaluation version', exact: true });
    await save.scrollIntoViewIfNeeded();
    await save.focus();
    const bounds = await save.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `test-results/scenarios/custom-actions-${width}x${height}.png`, fullPage: true });
    await page.keyboard.press('Tab');
    expect(await custom.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(custom).not.toBeVisible();
  }
  const sparse = manifest.projects.find((value: { key: string }) => value.key === 'sparse').id;
  await page.goto(`/projects/${sparse}/experiments`);
  await expect(page.getByRole('heading', { name: 'Experiments', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/scenarios/empty-experiments.png', fullPage: true });
});
