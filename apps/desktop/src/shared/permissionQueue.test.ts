import { describe, expect, it } from 'vitest';

import { PermissionQueue } from './permissionQueue';

describe('PermissionQueue', () => {
  it('resolves a waiting request with the user decision', async () => {
    const queue = new PermissionQueue();
    const pending = queue.wait('req-1');
    expect(queue.size).toBe(1);
    expect(queue.has('req-1')).toBe(true);

    const found = queue.resolve({ requestId: 'req-1', allow: true, remember: true });
    expect(found).toBe(true);
    await expect(pending).resolves.toEqual({ requestId: 'req-1', allow: true, remember: true });
    expect(queue.size).toBe(0);
  });

  it('reports false for an unknown/late answer', () => {
    const queue = new PermissionQueue();
    expect(queue.resolve({ requestId: 'unbekannt', allow: false })).toBe(false);
  });

  it('denies all open requests with denyAll', async () => {
    const queue = new PermissionQueue();
    const a = queue.wait('a');
    const b = queue.wait('b');
    queue.denyAll();
    await expect(a).resolves.toEqual({ requestId: 'a', allow: false });
    await expect(b).resolves.toEqual({ requestId: 'b', allow: false });
    expect(queue.size).toBe(0);
  });
});
