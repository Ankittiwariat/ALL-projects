import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Expect either "Bearer <token>" or plain "<token>" (backwards-compat)
    if (!authHeader) {
        return res.status(401).json({ success: false, message: "Not authorized, no token provided" });
    }

    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized, user not found" });
        }

        req.user = user;
        next();
    } catch (error) {
        const message = error.name === 'TokenExpiredError'
            ? "Session expired, please log in again"
            : "Not authorized, invalid token";
        return res.status(401).json({ success: false, message });
    }
};