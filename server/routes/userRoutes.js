import express from "express";
import { getPublishedImages, getUser, loginUser, registerUser, updateTheme } from "../controllers/userController.js";
import { protect } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { registerSchema, loginSchema } from "../validators/authValidators.js";
import rateLimit from "express-rate-limit";

const userRouter = express.Router();

// Strict rate limit on auth endpoints to prevent brute-force / credential stuffing
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // max 10 attempts per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again in 15 minutes." },
});

userRouter.post('/register', authLimiter, validate(registerSchema), registerUser)
userRouter.post('/login',    authLimiter, validate(loginSchema),    loginUser)
userRouter.get('/data',      protect, getUser)
userRouter.post('/theme',    protect, updateTheme)
userRouter.get('/published-images', getPublishedImages)

export default userRouter;