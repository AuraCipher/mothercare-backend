import { Router } from 'express';
import examTypeRoutes from './exam-type.routes';
import examRoutes from './exam.routes';
import examStructureRoutes from './exam-structure.routes';
import marksEntryRoutes from './marks-entry.routes';
import subjectResultRoutes from './subject-result.routes';
import reportCardRoutes from './report-card.routes';
import resultAnalyticsRoutes from './result-analytics.routes';

/**
 * Result & Grade module — all routes mounted at /admin/result/*
 */
const router = Router();

router.use(examTypeRoutes);
router.use(examRoutes);
router.use(examStructureRoutes);
router.use(marksEntryRoutes);
router.use(subjectResultRoutes);
router.use(reportCardRoutes);
router.use(resultAnalyticsRoutes);

export default router;
