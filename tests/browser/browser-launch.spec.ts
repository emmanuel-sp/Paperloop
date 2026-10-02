import { test, expect } from '@playwright/test';

test('trusted launch connects once, strips the fragment, and survives refresh without storing credentials', async ({ page, request, browser }) => {
  const fixture = await request.post('/__test/launch', { data: {} });
  const { url, projectId } = await fixture.json();
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (item) => requests.push({ url: item.url(), authorization: item.headers()['authorization'] }));
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByLabel('Connection secret')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/browser-launch/overview-desktop.png', fullPage: true });
  expect(page.url()).not.toContain('launch=');
  expect(requests.filter((item) => item.url.endsWith('/api/v1/session/launch'))).toHaveLength(1);
  expect(requests.every((item) => !item.authorization && !item.url.includes('launch='))).toBe(true);
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === 'paperloop_session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => ({ cookies: document.cookie, local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ cookies: '', local: {}, session: {} });
  await page.goto(`/projects/${projectId}/research`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/browser-launch/research-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/browser-launch/research-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  const other = await browser.newContext();
  try {
    const replay = await other.newPage();
    await replay.goto(url);
    await expect(replay.getByRole('alert')).toContainText('expired or already used');
    await expect(replay.getByLabel('Connection secret')).toBeVisible();
    expect(replay.url()).not.toContain('launch=');
  } finally {
    await other.close();
  }
});

test('expired launch explains recovery and keeps manual connection usable on narrow screens', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await request.post('/__test/launch', { data: { expired: true } });
  const { url, projectId } = await fixture.json();
  const target = new URL(url);
  target.pathname = `/projects/${projectId}/research`;
  await page.goto(target.href);
  await expect(page.getByRole('alert')).toContainText('Restart Paperloop');
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/research$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/browser-launch/expired-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/browser-launch/expired-desktop.png', fullPage: true });
  await page.getByLabel('Connection secret').fill('browser-fixture-secret');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
});

test('launching into an existing disconnected tab exchanges a fresh capability', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByLabel('Connection secret')).toBeVisible();
  const fixture = await request.post('/__test/launch', { data: {} });
  const { url } = await fixture.json();
  await page.evaluate((target) => { window.location.href = target; }, url);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  expect(page.url()).not.toContain('launch=');
});
