import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index.js';

describe('health response', () => {
  it('rejects invalid service status', () => {
    expect(healthResponseSchema.safeParse({ status: 'failed' }).success).toBe(false);
  });
});
