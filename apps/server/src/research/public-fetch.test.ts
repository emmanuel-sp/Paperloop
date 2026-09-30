import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('node:dns', () => ({ lookup: mocks.lookup }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(public options: unknown) {}
    destroy = mocks.destroy;
  },
  fetch: mocks.fetch,
}));
import { fetchPublicResource } from './public-fetch.js';

interface TestAgent {
  options: {
    connect: {
      lookup: (
        hostname: string,
        options: { family: number },
        callback: (
          error: Error | null,
          address: string,
          family: number,
        ) => void,
      ) => void;
    };
  };
}
beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.fetch.mockReset();
  mocks.destroy.mockReset();
  mocks.destroy.mockResolvedValue(undefined);
  mocks.lookup.mockImplementation((_host, _options, callback) =>
    callback(null, [{ address: '93.184.216.34', family: 4 }]),
  );
});
async function resolve(agent: TestAgent, host: string) {
  return new Promise<string>((accept, reject) =>
    agent.options.connect.lookup(host, { family: 0 }, (error, address) =>
      error ? reject(error) : accept(address),
    ),
  );
}
describe('bounded public-source transport', () => {
  it('pins a public resolved address, reads bounded text, and destroys the dispatcher', async () => {
    mocks.fetch.mockImplementation(
      async (url: URL, { dispatcher }: { dispatcher: TestAgent }) => {
        expect(await resolve(dispatcher, url.hostname)).toBe('93.184.216.34');
        return new Response('safe content', {
          headers: { 'content-type': 'text/plain' },
        });
      },
    );
    const result = await fetchPublicResource('https://example.com/article');
    expect(Buffer.from(result.body).toString()).toBe('safe content');
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('rejects non-public DNS results including mixed public/private answers', async () => {
    mocks.lookup.mockImplementation((_host, _options, callback) =>
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    );
    mocks.fetch.mockImplementation(
      async (url: URL, { dispatcher }: { dispatcher: TestAgent }) => {
        await resolve(dispatcher, url.hostname);
        return new Response('must not be read');
      },
    );
    await expect(
      fetchPublicResource('https://public-looking.example/article'),
    ).rejects.toThrow('non-public');
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('revalidates private redirects and limits redirect chains', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:80/secret' },
      }),
    );
    await expect(
      fetchPublicResource('https://example.com/article'),
    ).rejects.toThrow('public HTTP');
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: '/again' } }),
    );
    await expect(
      fetchPublicResource('https://example.com/article'),
    ).rejects.toThrow('redirect limit');
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
  });
  it('reports rate limits and rejects oversized bodies even without Content-Length', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
    );
    const before = Date.now();
    try {
      await fetchPublicResource('https://example.com/feed');
      throw new Error('Expected rate limit');
    } catch (error) {
      expect(error).toMatchObject({ message: 'Source returned HTTP 429.' });
      expect(
        Date.parse((error as { retryAt: string }).retryAt),
      ).toBeGreaterThanOrEqual(before + 120000);
    }
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, { headers: { 'content-length': '10485761' } }),
    );
    await expect(
      fetchPublicResource('https://example.com/large'),
    ).rejects.toThrow('10 MiB');
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(10485761)));
    await expect(
      fetchPublicResource('https://example.com/stream'),
    ).rejects.toThrow('10 MiB');
  });
});
