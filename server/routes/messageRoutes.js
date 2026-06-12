import express from 'express';
import { protect } from '../middlewares/auth.js';
import { imageMessageController, textMessageController, streamTextMessageController } from '../controllers/messageController.js';
import { validate } from '../middlewares/validate.js';
import { textMessageSchema, imageMessageSchema } from '../validators/messageValidators.js';

const messageRouter = express.Router()

messageRouter.get('/text/stream', streamTextMessageController)   // SSE — auth via query token
messageRouter.post('/text', protect, validate(textMessageSchema), textMessageController)
messageRouter.post('/image', protect, validate(imageMessageSchema), imageMessageController)

export default messageRouter