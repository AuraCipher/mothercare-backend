import { prisma } from '../../../lib/prisma';

const DEFAULT_BANDS = [
  { minPercent: 90, maxPercent: 100, label: 'A+', gpa: 4.0 },
  { minPercent: 80, maxPercent: 89.99, label: 'A', gpa: 3.7 },
  { minPercent: 70, maxPercent: 79.99, label: 'B+', gpa: 3.3 },
  { minPercent: 60, maxPercent: 69.99, label: 'B', gpa: 3.0 },
  { minPercent: 50, maxPercent: 59.99, label: 'C+', gpa: 2.3 },
  { minPercent: 40, maxPercent: 49.99, label: 'C', gpa: 2.0 },
  { minPercent: 30, maxPercent: 39.99, label: 'D', gpa: 1.3 },
  { minPercent: 20, maxPercent: 29.99, label: 'E', gpa: 1.0 },
  { minPercent: 0, maxPercent: 19.99, label: 'F', gpa: 0.0 },
];

/**
 * Seeds the default "Standard" grade scale if one doesn't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function seedDefaultGradeScale() {
  const existing = await prisma.gradeScale.findFirst({ where: { isDefault: true } });
  if (existing) return existing;

  return prisma.gradeScale.create({
    data: {
      name: 'Standard',
      isDefault: true,
      bands: {
        create: DEFAULT_BANDS,
      },
    },
    include: { bands: true },
  });
}
