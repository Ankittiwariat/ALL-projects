import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import connectDB from './configs/db.js'
import userRouter from './routes/userRoutes.js'
import chatRouter from './routes/chatRoutes.js'
import messageRouter from './routes/messageRoutes.js'
import creditRouter from './routes/creditRoutes.js'
import translationRouter from './routes/translationRoutes.js'
import { stripeWebhooks } from './controllers/webhooks.js'
import { errorHandler } from './middlewares/errorHandler.js'
import rateLimit from 'express-rate-limit';

const app = express()

app.set('trust proxy', 1)

// Rate limiting for AI message endpoints
// const messageLimiter = rateLimit({
//     windowMs: 60 * 1000, // 1 minute
//     max: 20,             // limit each IP to 20 requests per minute
//     standardHeaders: true,
//     legacyHeaders: false,
//     message: { success: false, message: "Too many requests, please try again after a minute" }
// });

app.set('trust proxy', 1)

// Rate limiting for AI message endpoints
const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests, please try again after a minute"
    }
});

await connectDB()

// Stripe Webhooks — raw body must come before express.json()
app.post('/api/stripe', express.raw({ type: 'application/json' }), stripeWebhooks)

// Core middleware

// Request Logger (Helps debug CORS and Network issues)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin || 'N/A'}`);
    next();
});

// app.use(cors())
app.use(cors({
    origin: function (origin, callback) {
        callback(null, true);
    },
    credentials: true
}))

app.use(express.json())

// Routes
app.get('/', (req, res) => res.send('Server is Live!'))
app.use('/api/user', userRouter)
app.use('/api/chat', chatRouter)
app.use('/api/message', messageLimiter, messageRouter)
app.use('/api/credit', creditRouter)
app.use('/api/translate', messageLimiter, translationRouter)

// Global error handler — MUST be last
app.use(errorHandler)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
