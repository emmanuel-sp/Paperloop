import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  const fixture = await page.request.post('/__test/github', {
    data: { state: 'connected' },
  });
  const { repository } = (await fixture.json()) as { repository: string };
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.goto('/projects/new');
  await page
    .getByLabel('Project name', { exact: true })
    .fill('GitHub research lab');
  await page.getByRole('radio', { name: 'GitHub', exact: true }).check();
  return repository;
}

test('connected private search and URL selection retain input after revoked access', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await expect(page.getByText('Connected as')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /research-team\/private-lab/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Search GitHub repositories').fill('no-results');
  await page
    .getByRole('button', { name: 'Search repositories', exact: true })
    .click();
  await expect(page.getByText('No repositories found.')).toBeVisible();
  await page.getByLabel('Search GitHub repositories').fill('private');
  await page.getByLabel('Search GitHub repositories').press('Enter');
  await expect(
    page.getByRole('button', { name: /research-team\/private-lab/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /research-team\/public-lab/ }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /research-team\/private-lab/ })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Selected research-team/private-lab' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/foundations/github-picker-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/foundations/github-picker-mobile.png',
    fullPage: true,
  });
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/research-team/denied');
  await page.getByRole('button', { name: 'Check repository' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot read');
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/research-team/private-lab.git');
  await page.getByRole('button', { name: 'Check repository' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Selected research-team/private-lab' }),
  ).toBeVisible();
  await page.request.post('/__test/github', { data: { state: 'denied' } });
  await page
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('cannot read');
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
    'GitHub research lab',
  );
  await expect(page.getByLabel('GitHub repository URL')).toHaveValue(
    'https://github.com/research-team/private-lab.git',
  );
  await page.request.post('/__test/github', { data: { state: 'connected' } });
  await page
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Review project context' })).toBeVisible();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview$/);
  const projectId = page.url().split('/projects/')[1]!.split('/')[0]!;
  const saved = await page.request.get(`/api/v1/projects/${projectId}`);
  expect(((await saved.json()) as { repository: unknown }).repository).toEqual({
    kind: 'github',
    owner: 'research-team',
    repository: 'private-lab',
  });
  expect(errors).toEqual([]);
});

test('connection recovery preserves the form and keeps local setup available', async ({
  page,
}) => {
  const repository = await setup(page);
  const scenarios = [
    ['disconnected', 'Sign in with GitHub CLI'],
    ['expired', 'sign-in has expired'],
    ['denied', 'cannot read'],
    ['limited', 'limiting requests'],
  ];
  for (const [state, message] of scenarios) {
    await page.request.post('/__test/github', { data: { state } });
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('alert')).toContainText(message!);
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
      'GitHub research lab',
    );
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true }),
    ).toBeDisabled();
  }
  await page.request.post('/__test/github', { data: { state: 'connected' } });
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByText('Connected as')).toBeVisible();
  await page.getByRole('radio', { name: 'Local directory' }).check();
  await page.getByLabel('Absolute directory path').fill(repository);
  await page
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Review project context' })).toBeVisible();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview$/);
  await expect(page.getByText('local', { exact: true })).toBeVisible();
});

test('GitHub experiment checkout guidance appears only during contextual preparation', async ({
  page,
}) => {
  const repository = await setup(page);
  await page
    .getByRole('button', { name: /research-team\/private-lab/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Review project context' })).toBeVisible();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview$/);
  const projectId = page.url().split('/projects/')[1]!.split('/')[0]!;
  const paper = await page.request.post(
    `/api/v1/projects/${projectId}/research`,
    {
      data: {
        title: 'Checkout guidance fixture',
        sourceKind: 'reference',
        sourceReference: 'Local browser fixture',
        submittedBy: 'user',
        extractionStatus: 'complete',
        extractedContent: 'Measure a focused change.',
      },
    },
  );
  const paperId = ((await paper.json()) as { id: string }).id;
  await expect(page.getByLabel('Local execution checkout')).toHaveCount(0);
  await page.goto(
    `/projects/${projectId}/experiments?view=prepare&paper=${paperId}`,
  );
  const dialog = page.getByRole('dialog', { name: 'Prepare experiment' });
  await expect(dialog.getByLabel('Local execution checkout')).toBeVisible();
  await dialog.getByLabel('Local execution checkout').fill(repository);
  await expect(
    dialog.getByText('Choose an existing committed checkout', { exact: false }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Prepare experiment', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Approve an evaluation before preparing work.', {
      exact: false,
    }),
  ).toBeVisible();
});
