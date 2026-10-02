import { test, expect, type Page } from '@playwright/test';
async function connect(page: Page) {
  await page.goto('/');
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'Retrieval lab' });
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
    .getByRole('button', { name: 'Saved research', exact: true })
    .click();
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
  await expect(page.getByRole('navigation', { name: 'Research views' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Discover research', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ideas to build on.' })).toBeVisible();
  await page.getByRole('button', { name: 'Saved research', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Saved research', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Saved research' }).click();
  await expect(page).not.toHaveURL(/view=library/);
  for (const name of ['Experiments', 'Schedules', 'Settings']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', { name, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.locator('#workspace')).toBeFocused();
  }
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      'Overview',
      'Research',
      'Schedules',
      'Experiments',
      'Settings',
    ]) {
      await page.getByRole('link', { name, exact: true }).click();
      await expect(
        page.getByRole('heading', { name, exact: true, level: 1 }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByRole('link', { name: 'Experiments', exact: true }).click();
  await page.getByRole('link', { name: 'Review Evaluation' }).click();
  await page.getByRole('button', { name: 'Approve version 1' }).click();
  await expect(page.getByText('Version 1 · Approved')).toBeVisible();
  await page.getByRole('button', { name: 'Close Evaluation' }).click();
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  await page
    .getByRole('button', { name: 'Saved research', exact: true })
    .click();
  await page
    .getByRole('button', { name: /A focused retrieval technique/ })
    .click();
  await page.getByRole('link', { name: 'Start experiment' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Prepare experiment', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Paper', exact: true })
    .selectOption({ label: 'A focused retrieval technique' });
  await page
    .getByRole('combobox', { name: 'Approved evaluation plan', exact: true })
    .selectOption({ label: 'Retrieval quality v1' });
  await page
    .getByRole('button', { name: 'Prepare experiment', exact: true })
    .click();
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

test('retired bookmarks preserve context within the five project sections', async ({
  page,
}) => {
  await connect(page);
  const projectPath = new URL(page.url()).pathname.replace(/\/overview$/, '');
  for (const [legacy, destination] of [
    ['sources', 'research?paper=preserved&view=sources'],
    ['library', 'research?paper=preserved&view=library'],
    ['evaluations', 'experiments?paper=preserved&view=evaluation'],
    ['evaluation-plans', 'experiments?paper=preserved&view=evaluation'],
    ['agent-api', 'settings?paper=preserved&view=agent-api'],
  ]) {
    await page.goto(`${projectPath}/${legacy}?paper=preserved`);
    await expect(page).toHaveURL(`${projectPath}/${destination}`);
    await expect(
      page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link'),
    ).toHaveCount(5);
  }
});

test('focused dialogs contain focus, restore triggers, dismiss, and preserve failed input', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  const sources = page.getByRole('button', { name: 'Sources', exact: true });
  await sources.click();
  const sourceDialog = page.getByRole('dialog', {
    name: 'Research sources',
    exact: true,
  });
  await expect(sourceDialog).toBeVisible();
  await expect(
    sourceDialog.getByRole('heading', {
      name: 'Research sources',
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    sourceDialog.getByText('Individual source overrides'),
  ).toBeVisible();
  for (let step = 0; step < 20; step++) {
    await page.keyboard.press(step < 10 ? 'Tab' : 'Shift+Tab');
    expect(
      await sourceDialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sourceDialog).not.toBeVisible();
  await expect(sources).toBeFocused();
  await sources.click();
  await expect(sourceDialog).toBeVisible();
  await expect(
    sourceDialog.getByRole('heading', {
      name: 'Research sources',
      exact: true,
    }),
  ).toBeFocused();
  await page.mouse.click(4, 4);
  await expect(sourceDialog).not.toBeVisible();
  await expect(sources).toBeFocused();

  await page.getByRole('button', { name: 'Import paper' }).click();
  const paperDialog = page.getByRole('dialog', {
    name: 'Import paper',
    exact: true,
  });
  const title = paperDialog.getByLabel('Title', { exact: true });
  await title.fill('Synthetic dialog validation fixture');
  await expect(title).toHaveAttribute('aria-describedby', /hint/);
  await paperDialog.getByRole('button', { name: 'Save paper' }).click();
  await expect(paperDialog).toBeVisible();
  await expect(title).toHaveValue('Synthetic dialog validation fixture');
  expect(
    await paperDialog
      .getByLabel('URL or reference')
      .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
  ).toBe(true);
  await paperDialog.getByLabel('Reference type').selectOption('reference');
  await paperDialog
    .getByLabel('URL or reference')
    .fill('Synthetic browser test, not a publication');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/projects/*/research', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    return route.fulfill({
      status: 503,
      json: {
        code: 'FIXTURE_FAILURE',
        message: 'Controlled save failure. Try again.',
      },
    });
  });
  await paperDialog.getByRole('button', { name: 'Save paper' }).click();
  await expect(
    paperDialog.getByRole('button', { name: 'Saving…' }),
  ).toBeDisabled();
  await expect(
    paperDialog.getByRole('button', { name: 'Close Import paper' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(paperDialog).toBeVisible();
  release();
  await expect(paperDialog.getByRole('alert')).toContainText(
    'Controlled save failure',
  );
  await expect(title).toHaveValue('Synthetic dialog validation fixture');
  await page.unroute('**/api/v1/projects/*/research');
  await paperDialog.getByRole('button', { name: 'Save paper' }).click();
  await expect(paperDialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic dialog validation fixture',
      exact: true,
    }),
  ).toBeVisible();
});

test('populated section and dialog examples at desktop and narrow widths', async ({
  page,
}) => {
  await connect(page);
  const response = await page.request.post('/__test/foundations');
  expect(response.ok()).toBe(true);
  const fixture = (await response.json()) as {
    projectId: string;
    experimentId: string;
    paperId: string;
  };
  const base = `/projects/${fixture.projectId}`;
  for (const [size, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const [section, query, ready] of [
      ['overview', '', 'What you’re building'],
      [
        'research',
        `?view=recommendations&paper=${fixture.paperId}`,
        'Test a focused retrieval change',
      ],
      [
        'experiments',
        `?experiment=${fixture.experimentId}`,
        'Improvement measured',
      ],
      ['schedules', '', 'Daily research'],
      ['settings', '', 'API analysis'],
    ]) {
      await page.goto(`${base}/${section}${query}`);
      await expect(
        page
          .getByRole('heading', {
            name: ready!,
            exact: section !== 'schedules',
          })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByRole('navigation', { name: 'Project sections' })
          .getByRole('link'),
      ).toHaveCount(5);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      if (size === 'mobile') {
        const navigation = page.getByRole('navigation', {
          name: 'Project sections',
        });
        await expect
          .poll(() =>
            navigation.evaluate((nav) => {
              const active = nav.querySelector('[aria-current="page"]');
              if (!active) return false;
              const item = active.getBoundingClientRect();
              const bounds = nav.getBoundingClientRect();
              return item.left >= bounds.left && item.right <= bounds.right;
            }),
          )
          .toBe(true);
      }
      await page.screenshot({
        path: `test-results/foundations/${section}-${size}.png`,
        fullPage: true,
      });
      if (section === 'experiments' && size === 'mobile') {
        const comparison = page
          .getByRole('region', { name: 'Metric comparison' })
          .first();
        await comparison.focus();
        await comparison.press('ArrowRight');
        await expect
          .poll(() => comparison.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
      }
    }
    await expect(
      page.getByText('Paid analysis is disabled.', { exact: false }),
    ).toBeVisible();
    await page.goto(`${base}/research`);
    await expect(
      page.getByRole('heading', { name: 'Discover research', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/foundations/discovery-${size}.png`,
      fullPage: true,
    });
    await page.goto(`${base}/research?view=sources`);
    await expect(
      page.getByRole('dialog', { name: 'Research sources', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Choose what this project follows', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/foundations/sources-dialog-${size}.png`,
    });
    await page.keyboard.press('Escape');
    await page.goto(`${base}/experiments?experiment=${fixture.experimentId}`);
    const evaluationTrigger = page.getByRole('link', {
      name: 'Review Evaluation',
      exact: true,
    });
    await evaluationTrigger.click();
    const evaluation = page.getByRole('dialog', {
      name: 'Evaluation',
      exact: true,
    });
    await expect(evaluation).toBeVisible();
    await expect(
      evaluation.getByRole('heading', {
        name: 'Retrieval quality',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`experiment=${fixture.experimentId}`),
    );
    await page.screenshot({
      path: `test-results/foundations/evaluation-dialog-${size}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(evaluation).not.toBeVisible();
    await expect(evaluationTrigger).toBeFocused();
    await expect(
      page.getByRole('heading', { name: 'Improvement measured' }),
    ).toBeVisible();
  }
});

test('populated section progress reports service work before agent activity', async ({
  page,
}) => {
  await connect(page);
  const response = await page.request.post('/__test/foundations');
  expect(response.ok()).toBe(true);
  const fixture = (await response.json()) as {
    projectId: string;
    paperId: string;
  };
  const base = `/projects/${fixture.projectId}`;
  await page.route(`**/api/v1/projects/${fixture.projectId}/sources`, (route) =>
    route.fulfill({
      json: {
        selection: {},
        sources: [{ id: 'fixture', name: 'Fixture source', kind: 'arxiv', coverage: 'Synthetic browser fixture' }],
      },
    }),
  );
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let documentIds = [fixture.paperId];
  await page.route(`**/api/v1/projects/${fixture.projectId}/discovery/search`, async (route) => {
    await gate;
    await route.fulfill({ json: {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: fixture.projectId,
      query: 'retrieval',
      createdAt: new Date().toISOString(),
      documentIds,
      outcomes: [],
      analysisStatus: 'waiting_for_agent',
    } });
  });
  await page.goto(`${base}/research`);
  await page.getByLabel('Research question').fill('retrieval');
  await page.getByRole('button', { name: 'Search sources', exact: true }).click();
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Agent analysis has not started.' })).toBeVisible();
    await expect(page.getByText('Agent working', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/foundations/discovery-working.png', fullPage: true });
  } finally { release(); }
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for a coding agent to take the work' })).toBeVisible();
  await page.screenshot({ path: 'test-results/foundations/discovery-waiting.png', fullPage: true });
  documentIds = [];
  await page.getByRole('button', { name: 'Search sources', exact: true }).click();
  await expect(page.getByText('No papers to assess', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for a coding agent to take the work' })).toHaveCount(0);

  gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/projects/${fixture.projectId}/experiments`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    await route.fulfill({ status: 503, json: { message: 'Controlled preparation failure' } });
  });
  await page.goto(`${base}/experiments?view=prepare&paper=${fixture.paperId}`);
  const dialog = page.getByRole('dialog', { name: 'Prepare experiment', exact: true });
  await dialog.getByRole('combobox', { name: 'Approved evaluation plan', exact: true }).selectOption({ label: 'Retrieval quality v1' });
  await dialog.getByRole('button', { name: 'Prepare experiment', exact: true }).click();
  try {
    await expect(dialog.getByRole('status')).toContainText('Agent work begins only after the task is claimed.');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: 'test-results/foundations/preparation-working.png' });
  } finally { release(); }
  await expect(dialog.getByRole('alert')).toContainText('Controlled preparation failure');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Paper', exact: true })).toHaveValue(fixture.paperId);
  await expect(dialog.getByRole('button', { name: 'Prepare experiment', exact: true })).toBeEnabled();
});

test('shared loading, empty, and recoverable error states', async ({
  page,
}) => {
  await connect(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/projects', async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Opening your workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  await page.screenshot({ path: 'test-results/foundations/loading.png' });
  release();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/v1/projects');
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Create your first project' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/foundations/empty.png' });
  await page.unroute('**/api/v1/projects');
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: 'FIXTURE_FAILURE',
        message: 'Local service is temporarily unavailable.',
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'Local service is temporarily unavailable.',
    { timeout: 15000 },
  );
  await page.screenshot({ path: 'test-results/foundations/error.png' });
  await page.unroute('**/api/v1/projects');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
});

test('research composer grows with a draft and supports focused URL import', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  const composer = page.getByLabel('Research question', { exact: true });
  const originalHeight = await composer.evaluate(
    (element) => element.clientHeight,
  );
  await composer.fill(
    Array.from({ length: 12 }, (_, i) => `Research direction ${i}`).join('\n'),
  );
  const expandedHeight = await composer.evaluate(
    (element) => element.clientHeight,
  );
  expect(expandedHeight).toBeGreaterThan(originalHeight);
  expect(expandedHeight).toBeLessThanOrEqual(280);
  expect(
    await composer.evaluate((element) => getComputedStyle(element).resize),
  ).toBe('none');
  await composer.fill('Improve retrieval grounding');
  expect(await composer.evaluate((element) => element.clientHeight)).toBe(
    originalHeight,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer).toHaveValue('Improve retrieval grounding');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const trigger = page.getByRole('button', {
    name: 'Fetch an article by URL',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', {
    name: 'Fetch an article',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Fetch a paper or article URL')
    .fill('https://example.org/research');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.screenshot({
    path: 'test-results/foundations/discovery-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/foundations/discovery-desktop.png',
    fullPage: true,
  });
});

test('schedule dialogs and nested evaluation forms contain focus and return to their actions', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  const scheduleTrigger = page.getByRole('button', {
    name: 'New schedule',
    exact: true,
  });
  await scheduleTrigger.click();
  const schedule = page.getByRole('dialog', {
    name: 'New schedule',
    exact: true,
  });
  await expect(schedule).toBeVisible();
  await schedule
    .getByLabel('Timezone', { exact: true })
    .fill('America/Los_Angeles');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
    expect(
      await schedule.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: 'test-results/foundations/schedule-dialog-desktop.png',
  });
  await page.keyboard.press('Escape');
  await expect(scheduleTrigger).toBeFocused();
  await page.getByRole('link', { name: 'Experiments', exact: true }).click();
  await page
    .getByRole('link', { name: 'Review Evaluation', exact: true })
    .click();
  const evaluation = page.getByRole('dialog', {
    name: 'Evaluation',
    exact: true,
  });
  const createTrigger = evaluation.getByRole('button', {
    name: 'Create an evaluation plan',
    exact: true,
  });
  await createTrigger.click();
  const creating = page.getByRole('dialog', {
    name: 'Create an evaluation plan',
    exact: true,
  });
  await expect(creating).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i < 15 ? 'Tab' : 'Shift+Tab');
    expect(
      await creating.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(creating).not.toBeVisible();
  await expect(evaluation).toBeVisible();
  await expect(createTrigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(evaluation).not.toBeVisible();
});

test('library filters survive reload and schedule removal requires confirmation', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  await page
    .getByRole('button', { name: 'Saved research', exact: true })
    .click();
  await page
    .getByLabel('Search title, authors, or extracted text')
    .fill('retrieval');
  await page
    .getByRole('button', { name: 'Search saved research', exact: true })
    .click();
  await expect(page).toHaveURL(/libraryQuery=retrieval/);
  await page.reload();
  await expect(
    page.getByLabel('Search title, authors, or extracted text'),
  ).toHaveValue('retrieval');
  await page.getByLabel('Search across all projects').check();
  await expect(page).toHaveURL(/scope=all/);
  await page.goBack();
  await expect(page.getByLabel('Search across all projects')).not.toBeChecked();
  await page.goForward();
  await expect(page.getByLabel('Search across all projects')).toBeChecked();
  await page.goBack();
  await expect(page.getByLabel('Search across all projects')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close Saved research' }).click();
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  const remove = page
    .getByRole('button', { name: 'Remove', exact: true })
    .first();
  await remove.click();
  const dialog = page.getByRole('dialog', {
    name: 'Remove schedule',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Keep schedule', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog
    .getByRole('button', { name: 'Remove schedule', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText('Removed', { exact: true }).first(),
  ).toBeVisible();
  await expect(remove).toBeDisabled();
});

test('contextual preparation explains missing approval and returns to research', async ({
  page,
}) => {
  await connect(page);
  await page.route('**/api/v1/projects/*/evaluations', (route) =>
    route.fulfill({ json: { plans: [] } }),
  );
  await page.getByRole('link', { name: 'Research', exact: true }).click();
  await page
    .getByRole('button', { name: 'Saved research', exact: true })
    .click();
  await page
    .getByRole('button', { name: /A focused retrieval technique/ })
    .click();
  const paper = new URL(page.url()).searchParams.get('paper');
  await page
    .getByRole('link', { name: 'Start experiment', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Prepare experiment',
    exact: true,
  });
  await expect(
    dialog.getByRole('combobox', { name: 'Paper', exact: true }),
  ).toHaveValue(paper!);
  await expect(
    dialog.getByRole('button', { name: 'Prepare experiment', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Approve an evaluation before preparing work.', {
      exact: false,
    }),
  ).toBeVisible();
  await dialog
    .getByRole('link', { name: 'Review Evaluation', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Evaluation', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`paper=${paper}`));
  await page.keyboard.press('Escape');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', {
      name: 'A focused retrieval technique',
      exact: true,
    }),
  ).toBeVisible();
});
