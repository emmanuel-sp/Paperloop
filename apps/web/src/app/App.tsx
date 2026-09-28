import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router';
import { healthResponseSchema } from '@paperloop/contracts';

function Home() {
  const [status, setStatus] = useState('Checking local service…');

  useEffect(() => {
    const controller = new AbortController();

    async function checkService() {
      try {
        const response = await fetch('/api/v1/health', { signal: controller.signal });
        if (!response.ok) throw new Error('Service unavailable');
        healthResponseSchema.parse(await response.json());
        setStatus('Local service connected');
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus(error instanceof Error ? error.message : 'Service unavailable');
        }
      }
    }

    void checkService();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Paperloop</h1>
      <p>Research, experiments, and evidence for your projects.</p>
      <p role="status">{status}</p>
    </main>
  );
}

export function App() {
  return (
    <>
      <header><Link to="/">Paperloop</Link></header>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </>
  );
}
