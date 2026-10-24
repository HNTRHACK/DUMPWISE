import { growth, periods } from './analytics.service.js';
describe('analytics comparison semantics', () => {
  it('defines equal-length preceding periods across year boundaries', () => {
    expect(periods({ from: '2026-01', to: '2026-03' })).toMatchObject({ count: 3, previousFrom: '2025-10', previousTo: '2025-12' });
    expect(() => periods({ from: '2026-03', to: '2026-01' })).toThrow();
    expect(() => periods({ from: '2020-01', to: '2026-01' })).toThrow();
  });
  it('uses Decimal growth and explains missing, zero and negative comparison bases', () => {
    expect(growth('65.00', '50.00', 1, 1, 1).growthPercent).toBe('30.00');
    expect(growth('-25', '50', 1, 1, 1).growthPercent).toBe('-150.00');
    expect(growth('65', '0', 1, 1, 1).growthReason).toBe('Previous revenue is zero or negative');
    expect(growth('65', '-1', 1, 1, 1).growthPercent).toBeNull();
    expect(growth('65', '50', 1, 0, 1).growthReason).toBe('Incomplete comparison coverage');
  });
});
