import { test, expect, type Page } from '@playwright/test';

async function start(page: Page) {
  const fixture = await page.request.post('/__test/github', {
    data: { state: 'connected' },
  });
  const { repository } = await fixture.json();
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.goto('/projects/new');
  return repository as string;
}

test('local guided context has provenance, preserves corrections on retry, and saves without approving commands', async ({
  page,
}) => {
  const repository = await start(page);
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Guided retrieval');
  await expect(page.getByLabel('What does this project do?')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Local directory' }).check();
  await page.getByLabel('Absolute directory path').fill('/definitely/missing');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check the path');
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
    'Guided retrieval',
  );
  await page.getByLabel('Absolute directory path').fill(repository);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/projects/onboarding', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'No agent or evaluation is running',
  );
  await expect(page.getByLabel('Project name', { exact: true })).toBeDisabled();
  release();
  await expect(
    page.getByRole('heading', { name: 'Review project context' }),
  ).toBeFocused();
  await expect(page.getByLabel('What does this project do?')).toHaveValue(
    'Measure retrieval quality with a tiny local harness.',
  );
  await expect(page.getByText('Package script: test')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/onboarding/local-context-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/onboarding/local-context-mobile.png',
    fullPage: true,
  });
  await page
    .getByText('How this context was suggested', { exact: true })
    .click();
  await expect(page.getByText('Files: README.md, package.json')).toBeVisible();
  await page
    .getByLabel('What does this project do?')
    .fill('Corrected retrieval purpose.');
  await page
    .getByText('Adjust objectives, constraints & research direction', {
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', { name: 'Research direction', exact: true })
    .fill('Reduce irrelevant passages');
  await page.getByRole('button', { name: 'Back to repository' }).click();
  await expect(page.getByLabel('Absolute directory path')).toHaveValue(
    repository,
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('What does this project do?')).toHaveValue(
    'Corrected retrieval purpose.',
  );
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview$/);
  const id = page.url().split('/projects/')[1]!.split('/')[0]!;
  const project = await (
    await page.request.get(`/api/v1/projects/${id}`)
  ).json();
  expect(project.currentContext.inference.researchDirection).toBe(
    'Reduce irrelevant passages',
  );
  expect(project.currentContext.inference.correctedFields).toContain(
    'description',
  );
  const plans = await page.request.get(`/api/v1/projects/${id}/evaluations`);
  expect((await plans.json()).plans).toEqual([]);
  await page.reload();
  await page.getByText('Context & provenance', { exact: true }).click();
  await expect(
    page.getByText('Research direction: Reduce irrelevant passages'),
  ).toBeVisible();
});

test('description-only and unavailable inspection have honest manual recovery without a key', async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Description only');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('What does this project do?')).toHaveValue('');
  await page
    .getByText('How this context was suggested', { exact: true })
    .click();
  await expect(
    page.getByText('No repository is selected.', { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/onboarding/no-repository-mobile.png',
    fullPage: true,
  });
  await page
    .getByLabel('What does this project do?')
    .fill('A research prototype without code yet.');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto('/projects/new');
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Recovered project');
  await page.route('**/api/v1/projects/onboarding', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Inspection unavailable. Retry later.' }),
    }),
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Inspection unavailable');
  await page.screenshot({
    path: 'test-results/onboarding/failed-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Describe context manually' }).click();
  await page
    .getByLabel('What does this project do?')
    .fill('Manual context retained after a service failure.');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page).toHaveURL(/\/overview$/);
});

test('GitHub context retains a correction through revoked access at persistence', async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Private context');
  await page.getByRole('radio', { name: 'GitHub', exact: true }).check();
  await page
    .getByRole('button', { name: /research-team\/private-lab/ })
    .click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('What does this project do?')).toHaveValue(
    'Measure retrieval research against a private repository.',
  );
  await page
    .getByLabel('What does this project do?')
    .fill('Corrected private context.');
  await page.request.post('/__test/github', { data: { state: 'denied' } });
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('cannot read');
  await expect(page.getByLabel('What does this project do?')).toHaveValue(
    'Corrected private context.',
  );
  await page.request.post('/__test/github', { data: { state: 'connected' } });
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page).toHaveURL(/\/overview$/);
});
