import { isPassingResult, PASSING_MIN_PERCENT } from '../../src/modules/admin/services/result-analytics.service';

describe('result-analytics.service', () => {
  describe('isPassingResult', () => {
    it('passes at or above 40% with non-fail grade', () => {
      expect(isPassingResult(40, 'C')).toBe(true);
      expect(isPassingResult(85, 'A')).toBe(true);
    });

    it('fails below 40%', () => {
      expect(isPassingResult(39, 'C')).toBe(false);
    });

    it('fails on F, E, D grades regardless of percentage', () => {
      expect(isPassingResult(50, 'D')).toBe(false);
      expect(isPassingResult(50, 'F')).toBe(false);
      expect(isPassingResult(50, 'E')).toBe(false);
    });
  });

  it('uses 40% passing threshold constant', () => {
    expect(PASSING_MIN_PERCENT).toBe(40);
  });
});
