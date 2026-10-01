import { request } from './client';

// Capture once, before React (including StrictMode) or routing starts. A fragment
// never reaches the HTTP server; remove it before requests or rendering.
export function beginBrowserLaunch(): Promise<void> | undefined {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('launch')) return undefined;
  const token = parameters.get('launch');
  parameters.delete('launch');
  const hash = parameters.size ? `#${parameters}` : '';
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  return request('/api/v1/session/launch', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }).then(() => undefined);
}

// A browser opener may reuse an existing tab at the same pathname. Fragment-only
// navigation doesn't restart React, so load a fresh document for the exchange.
export function reloadOnBrowserLaunch(): void {
  window.addEventListener('hashchange', () => {
    if (new URLSearchParams(window.location.hash.slice(1)).has('launch')) {
      window.location.reload();
    }
  });
}
