import { lookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { publicUrlSchema } from '@paperloop/contracts';

export class SourceFetchError extends Error {
  constructor(
    message: string,
    public readonly retryAt: string | null = null,
  ) {
    super(message);
  }
}
export interface PublicResource {
  url: string;
  contentType: string;
  body: Uint8Array;
}
export type PublicFetcher = (url: string) => Promise<PublicResource>;

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
export function validatePublicUrl(value: string): URL {
  const url = new URL(publicUrlSchema.parse(value));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    (url.port && !['80', '443'].includes(url.port)) ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new SourceFetchError(
      'Research fetching requires a public HTTP(S) address on port 80 or 443.',
    );
  }
  return url;
}

// Resolve and validate at connection time, then connect to that exact address.
// This also applies to every redirect, preventing DNS rebinding into local services.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 4);
      return;
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    ) {
      callback(
        new Error('Research source resolves to a non-public address.'),
        '',
        4,
      );
      return;
    }
    const family = typeof options === 'object' ? options.family : options;
    const address =
      addresses.find((item) => !family || item.family === family) ??
      addresses[0]!;
    callback(null, address.address, address.family);
  });
};

export const fetchPublicResource: PublicFetcher = async (value) => {
  const agent = new Agent({
    connect: { lookup: publicLookup, autoSelectFamily: false },
    headersTimeout: 15000,
    bodyTimeout: 15000,
  });
  const signal = AbortSignal.timeout(20000);
  try {
    let url = validatePublicUrl(value);
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetch(url, {
        dispatcher: agent,
        signal,
        redirect: 'manual',
        headers: {
          'user-agent': 'Paperloop/0.1 (local research discovery)',
          accept:
            'application/atom+xml, application/rss+xml, text/html, application/pdf, text/plain, */*',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 4)
          throw new SourceFetchError('Source exceeded the redirect limit.');
        url = validatePublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
        const date = retry ? Date.parse(retry) : NaN;
        const retryAt = [429, 503].includes(response.status)
          ? new Date(
              Math.min(
                Date.now() + 86400000,
                Math.max(
                  Date.now() + 3000,
                  seconds !== null
                    ? Date.now() + seconds * 1000
                    : Number.isFinite(date)
                      ? date
                      : Date.now() + 60000,
                ),
              ),
            ).toISOString()
          : null;
        throw new SourceFetchError(
          `Source returned HTTP ${response.status}.`,
          retryAt,
        );
      }
      const maximum = 10 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > maximum) {
        await response.body?.cancel();
        throw new SourceFetchError('Source exceeds the 10 MiB download limit.');
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > maximum) {
            await response.body.cancel().catch(() => undefined);
            throw new SourceFetchError(
              'Source exceeds the 10 MiB download limit.',
            );
          }
          chunks.push(chunk);
        }
      }
      return {
        url: url.toString(),
        contentType: response.headers.get('content-type') ?? '',
        body: Buffer.concat(chunks),
      };
    }
    throw new SourceFetchError('Source exceeded the redirect limit.');
  } finally {
    await agent.destroy();
  }
};
