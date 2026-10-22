import { vi } from 'vitest';
import type { PrismaService } from './prisma.service.js';
import { TenantDb, type TenantTx } from './tenant-db.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function harness() {
  const execute = vi.fn().mockResolvedValue(1);
  const tx = { $executeRaw: execute } as unknown as TenantTx;
  const transaction = vi.fn(async (
    fn: (client: TenantTx) => Promise<unknown>,
    _options?: { timeout?: number; maxWait?: number },
  ) => fn(tx));
  const db = new TenantDb({ $transaction: transaction } as unknown as PrismaService);
  return { db, tx, execute, transaction };
}

describe('tenant transaction boundary (no database)', () => {
  it('awaits transaction-local, parameterized context before running work on the same client', async () => {
    const { db, tx, execute, transaction } = harness();
    let contextReady = false;
    execute.mockImplementation(async () => { contextReady = true; return 1; });
    const options = { timeout: 120_000, maxWait: 15_000 };
    const result = await db.run({ organizationId, userId }, async (client) => {
      expect(contextReady).toBe(true);
      expect(client).toBe(tx);
      return 'result';
    }, options);
    const [sql, ...values] = execute.mock.calls[0];
    expect(sql.join('?')).toBe("SELECT set_config('app.organization_id', ?, true), set_config('app.user_id', ?, true)");
    expect(values).toEqual([organizationId, userId]);
    expect(transaction.mock.calls[0][1]).toBe(options);
    expect(result).toBe('result');
  });

  it('explicitly clears absent context for user-only and anonymous work', async () => {
    const { db, execute } = harness();
    await db.run({ userId }, async () => undefined);
    await db.run({}, async () => undefined);
    expect(execute.mock.calls.map((call) => call.slice(1))).toEqual([['', userId], ['', '']]);
  });

  it.each([{ organizationId: "invalid'" }, { userId: 'invalid' }])('rejects invalid context before SQL or work: %j', async (ctx) => {
    const { db, execute } = harness();
    const work = vi.fn();
    await expect(db.run(ctx, work)).rejects.toThrow('Tenant context ids must be UUIDs');
    expect(execute).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('never runs work when context setup fails, and propagates work failures for rollback', async () => {
    const { db, execute } = harness();
    const failure = new Error('database failure');
    const work = vi.fn();
    execute.mockRejectedValueOnce(failure);
    await expect(db.run({ organizationId }, work)).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    await expect(db.run({ organizationId }, async () => { throw failure; })).rejects.toBe(failure);
  });
});
