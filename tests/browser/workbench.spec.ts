import { test, expect, type Page } from '@playwright/test';
async function connect(page: Page) {
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
}
test('navigation, paper evidence, keyboard focus, and narrow layouts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await connect(page);
  await expect(page.getByText('Review Retrieval quality')).toBeVisible();
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  await page
    .getByRole('button', { name: /A focused retrieval technique/ })
    .click();
  await expect(page).toHaveURL(/paper=/);
  await page.getByText('Full text', { exact: true }).click();
  await expect(
    page.getByText('Improve the score with a focused candidate change.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A focused retrieval technique' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Recommendations', exact: true })
    .click();
  await expect(page).toHaveURL(/view=recommendations/);
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'Library', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const name of [
    'Evaluation plans',
    'Experiments',
    'Schedules',
    'Sources',
    'Agent & API',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', { name, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('#workspace')).toBeFocused();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    'Overview',
    'Research',
    'Schedules',
    'Evaluation plans',
    'Experiments',
    'Agent & API',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Tab');
  // Explicitly exercise skip navigation independently of tab order after route focus.
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace')).toBeFocused();
  await page.screenshot({
    path: 'test-results/workbench-mobile.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('browser approval through a complete paid-call-free Python comparison', async ({
  page,
}) => {
  await connect(page);
  await page
    .getByRole('link', { name: 'Evaluation plans', exact: true })
    .click();
  await page.getByRole('button', { name: 'Approve version 1' }).click();
  await expect(page.getByText('Version 1 · Approved')).toBeVisible();
  await page.getByRole('link', { name: 'Experiments', exact: true }).click();
  await page.getByText('New experiment', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Paper', exact: true })
    .selectOption({ label: 'A focused retrieval technique' });
  await page
    .getByRole('combobox', { name: 'Approved evaluation plan', exact: true })
    .selectOption({ label: 'Retrieval quality v1' });
  await page.getByRole('button', { name: 'Prepare experiment' }).click();
  await expect(page).toHaveURL(/experiment=/);
  const id = new URL(page.url()).searchParams.get('experiment');
  await expect(
    page.getByText('Waiting for agent', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Run baseline' }).click();
  await expect(page.getByText('score: 10 points', { exact: true })).toBeVisible(
    { timeout: 20000 },
  );
  const implemented = await page.request.post(`/__test/implement/${id}`);
  expect(implemented.ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Run candidate' })).toBeEnabled(
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Run candidate' }).click();
  await expect(page.getByText('score: 12 points', { exact: true })).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Compare runs' }).click();
  await expect(
    page.getByRole('heading', { name: 'Improvement measured' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '2 (20.00%)', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Improvement measured' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/workbench-comparison.png',
    fullPage: true,
  });
});
test('schedule setup and actionable validation errors', async ({ page }) => {
  await connect(page);
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'New schedule', exact: true }).click();
  await page.getByLabel('Timezone', { exact: true }).fill('invalid-timezone');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByLabel('Timezone', { exact: true })
    .fill('America/Los_Angeles');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(
    page.getByText('External setup/synchronization pending', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Native handoff' }).click();
  await expect(
    page.getByRole('heading', { name: 'Schedule instructions' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
});
