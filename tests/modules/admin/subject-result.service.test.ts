import {
  computeWeightedAverage,
  computeCompetitionRanks,
  lookupGrade,
} from '../../../src/modules/admin/services/subject-result.service';

describe('computeWeightedAverage', () => {
  test('simple equal-weight average', () => {
    const result = computeWeightedAverage([
      { marksObtained: 80, totalMarks: 100, weight: 1 },
      { marksObtained: 70, totalMarks: 100, weight: 1 },
    ]);
    expect(result).toBeCloseTo(75, 5);
  });

  test('weighted average with different weights', () => {
    // (80*30 + 70*60) / (30 + 60) = (2400 + 4200) / 90 = 73.33
    const result = computeWeightedAverage([
      { marksObtained: 80, totalMarks: 100, weight: 30 },
      { marksObtained: 70, totalMarks: 100, weight: 60 },
    ]);
    expect(result).toBeCloseTo(73.333, 2);
  });

  test('three exams with mixed weights', () => {
    // (80*30 + 70*60 + 90*1) / (30+60+1) = 6690/91 = 73.52
    const result = computeWeightedAverage([
      { marksObtained: 80, totalMarks: 100, weight: 30 },
      { marksObtained: 70, totalMarks: 100, weight: 60 },
      { marksObtained: 90, totalMarks: 100, weight: 1 },
    ]);
    expect(result).toBeCloseTo(73.516, 2);
  });

  test('absent student treated as 0 marks', () => {
    const result = computeWeightedAverage([
      { marksObtained: 0, totalMarks: 100, weight: 30 },
      { marksObtained: 85, totalMarks: 100, weight: 60 },
    ]);
    expect(result).toBeCloseTo(56.667, 2);
  });

  test('perfect score', () => {
    const result = computeWeightedAverage([
      { marksObtained: 100, totalMarks: 100, weight: 1 },
    ]);
    expect(result).toBe(100);
  });

  test('zero total weight falls back to equal split', () => {
    const result = computeWeightedAverage([
      { marksObtained: 80, totalMarks: 100, weight: 0 },
      { marksObtained: 60, totalMarks: 100, weight: 0 },
    ]);
    expect(result).toBe(70);
  });

  test('empty array returns 0', () => {
    expect(computeWeightedAverage([])).toBe(0);
  });

  test('handles decimal marksObtained', () => {
    const result = computeWeightedAverage([
      { marksObtained: 85.5, totalMarks: 100, weight: 1 },
    ]);
    expect(result).toBe(85.5);
  });
});

describe('computeCompetitionRanks', () => {
  test('no ties — descending', () => {
    expect(computeCompetitionRanks([90, 80, 70])).toEqual([1, 2, 3]);
  });

  test('ties share same rank, next skips', () => {
    // competition ranking: 1,2,2,4
    expect(computeCompetitionRanks([95, 85, 85, 70])).toEqual([1, 2, 2, 4]);
  });

  test('three-way tie at top', () => {
    expect(computeCompetitionRanks([90, 90, 90, 70])).toEqual([1, 1, 1, 4]);
  });

  test('single student', () => {
    expect(computeCompetitionRanks([75])).toEqual([1]);
  });

  test('all same score', () => {
    expect(computeCompetitionRanks([80, 80, 80])).toEqual([1, 1, 1]);
  });
});

describe('lookupGrade', () => {
  const bands = [
    { minPercent: 90, maxPercent: 100, label: 'A+' },
    { minPercent: 80, maxPercent: 89.99, label: 'A' },
    { minPercent: 70, maxPercent: 79.99, label: 'B+' },
    { minPercent: 60, maxPercent: 69.99, label: 'B' },
    { minPercent: 50, maxPercent: 59.99, label: 'C+' },
    { minPercent: 40, maxPercent: 49.99, label: 'C' },
    { minPercent: 30, maxPercent: 39.99, label: 'D' },
    { minPercent: 20, maxPercent: 29.99, label: 'E' },
    { minPercent: 0, maxPercent: 19.99, label: 'F' },
  ];

  test('A+ at 95', () => expect(lookupGrade(95, bands)).toBe('A+'));
  test('A at 85', () => expect(lookupGrade(85, bands)).toBe('A'));
  test('B+ at 75', () => expect(lookupGrade(75, bands)).toBe('B+'));
  test('B at 65', () => expect(lookupGrade(65, bands)).toBe('B'));
  test('C+ at 55', () => expect(lookupGrade(55, bands)).toBe('C+'));
  test('C at 45', () => expect(lookupGrade(45, bands)).toBe('C'));
  test('D at 35', () => expect(lookupGrade(35, bands)).toBe('D'));
  test('E at 25', () => expect(lookupGrade(25, bands)).toBe('E'));
  test('F at 15', () => expect(lookupGrade(15, bands)).toBe('F'));
  test('boundary A+ starts at 90', () => expect(lookupGrade(89.99, bands)).toBe('A'));
  test('boundary exactly 90 is A+', () => expect(lookupGrade(90, bands)).toBe('A+'));
  test('exactly 80 is A', () => expect(lookupGrade(80, bands)).toBe('A'));
});
