import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmProcessGroupStopped,
  processGroupStopped,
} from './process-group.js';

afterEach(() => vi.useRealTimers());

describe('process-group termination confirmation', () => {
  it('distinguishes live descendants from dead/unrelated groups', () => {
    expect(processGroupStopped(' 123 R\n 123 Z\n 456 Ss\n', 123)).toBe(false);
    expect(processGroupStopped(' 123 S\n', 123)).toBe(false);
    expect(processGroupStopped(' 123 D\n', 123)).toBe(false);
    expect(processGroupStopped(' 123 Z\n 123 X\n 456 Ss\n', 123)).toBe(true);
    expect(processGroupStopped(' 456 Ss\n', 123)).toBe(true);
    expect(processGroupStopped('', 123)).toBe(true);
    expect(processGroupStopped('unrecognized output', 123)).toBe(false);
  });

  it('waits for a runnable descendant to actually stop', async () => {
    vi.useFakeTimers();
    const inspect = vi
      .fn()
      .mockResolvedValueOnce('123 R')
      .mockResolvedValueOnce('123 S')
      .mockResolvedValue('123 Z');
    const confirmation = confirmProcessGroupStopped(123, inspect);
    await vi.runAllTimersAsync();
    expect(await confirmation).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it('bounds the wait and treats inspection failures as uncertain', async () => {
    vi.useFakeTimers();
    const confirmation = confirmProcessGroupStopped(123, async () => '123 D');
    await vi.runAllTimersAsync();
    expect(await confirmation).toBe(false);
    expect(
      await confirmProcessGroupStopped(123, async () => {
        throw new Error('ps unavailable');
      }),
    ).toBe(false);
  });
});
