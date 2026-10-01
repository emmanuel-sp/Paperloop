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
  await page
    .getByRole('button', { name: 'Recommendations', exact: true })
    .click();
  await expect(page).toHaveURL(/view=recommendations/);
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'Saved research', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Experiments', 'Schedules', 'Settings']) {
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
    'Experiments',
    'Settings',
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
  await page.getByRole('link', { name: 'Experiments', exact: true }).click();
  await page.getByRole('link', { name: 'Review Evaluation' }).click();
  await page.getByRole('button', { name: 'Approve version 1' }).click();
  await expect(page.getByText('Version 1 · Approved')).toBeVisible();
  await page.getByRole('button', { name: 'Close Evaluation' }).click();
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
