import { Router } from 'express';
import { createApiKey, listApiKeys, revokeApiKey } from './api-key.controller';
import auth from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';

const router = Router();

// All API key routes require super_admin
router.use(auth);
router.use(roleMiddleware(['super_admin']));

router.post('/', createApiKey);
router.get('/', listApiKeys);
router.delete('/:id', revokeApiKey);

export default router;
