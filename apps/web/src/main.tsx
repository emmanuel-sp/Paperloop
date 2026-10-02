import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { beginBrowserLaunch, reloadOnBrowserLaunch } from './api/browser-launch';
import './styles.css';

const root = document.getElementById('root');
const browserLaunch = beginBrowserLaunch();
reloadOnBrowserLaunch();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

if (!root) {
  throw new Error('Missing application root');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Native URL-driven controls must update with immediate Back/Forward. */}
      <BrowserRouter useTransitions={false}>
        <App browserLaunch={browserLaunch} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
