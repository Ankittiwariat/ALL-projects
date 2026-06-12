import express from 'express';
import { protect } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { translationSchema } from '../validators/translationValidators.js';
import { translateController, streamTranslateController } from '../controllers/translationController.js';

const translationRouter = express.Router();

// POST /api/translate
// Auth   : JWT required (protect middleware)
// Validate: Zod schema (text + direction)
// Cost   : 1 credit per request
translationRouter.post('/', protect, validate(translationSchema), translateController);

// GET /api/translate/stream
// Auth: token passed via query param (SSE limitation)
translationRouter.get('/stream', streamTranslateController);

export default translationRouter;
