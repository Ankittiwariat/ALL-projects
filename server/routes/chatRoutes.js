import express from "express";
import { createChat, deleteChat, getChats } from "../controllers/chatController.js";
import { protect } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { chatDeleteSchema } from "../validators/messageValidators.js";

const chatRouter = express.Router();

chatRouter.post('/create', protect, createChat)
chatRouter.get('/get', protect, getChats)
chatRouter.post('/delete', protect, validate(chatDeleteSchema), deleteChat)

export default chatRouter