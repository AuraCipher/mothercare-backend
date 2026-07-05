import { isPassingResult, PASSING_MIN_PERCENT, tallyPassFail } from '../../../src/modules/admin/services/result-analytics.service';

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

  describe('tallyPassFail', () => {
    it('counts subject-level pass and fail rows', () => {
      const items = [
        { percentage: 85, grade: 'A' },
        { percentage: 35, grade: 'D' },
        { percentage: 50, grade: 'C' },
        { percentage: 60, grade: 'F' },
      ];
      expect(tallyPassFail(items)).toEqual({ passed: 2, failed: 2, total: 4 });
    });

    it('includes failures that report-card overall grades would hide', () => {
      const subjectRows = [
        { percentage: 12, grade: 'F' },
        { percentage: 90, grade: 'A' },
        { percentage: 88, grade: 'A' },
      ];
      const reportCardOverall = [{ percentage: 63.3, grade: 'B' }];
      expect(tallyPassFail(subjectRows).failed).toBe(1);
      expect(tallyPassFail(reportCardOverall).failed).toBe(0);
    });
  });
});
