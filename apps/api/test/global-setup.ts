// Never reset an existing database. Creation is owned by the disposable runner.
export default async function setup(): Promise<void> {
 const name = process.env['DUMPWISE_DISPOSABLE_DB'];
 if (!name || !/^dumpwise_verify_[a-f0-9]+_test$/.test(name)) throw new Error('Use npm run test:e2e');
 for (const key of ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL', 'TEST_PROVISIONER_DATABASE_URL']) {
  if (new URL(process.env[key] ?? '').pathname !== '/' + name) throw new Error('Disposable database URL mismatch');
 }
}
