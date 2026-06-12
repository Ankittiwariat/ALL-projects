import User from "../models/User.js";
import jwt from 'jsonwebtoken'
import bcrypt from "bcryptjs";
import Chat from "../models/Chat.js";

// ─── Generate JWT ─────────────────────────────────────────────────────────────
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' })
}

// ─── Register User ────────────────────────────────────────────────────────────
export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check for existing user — use case-insensitive email match
        const userExists = await User.findOne({ email: email.toLowerCase().trim() })
        if (userExists) {
            return res.status(409).json({ success: false, message: "An account with this email already exists" })
        }

        const user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password
        })

        const token = generateToken(user._id)
        return res.status(201).json({ success: true, token })

    } catch (error) {
        // Mongoose duplicate key — race condition safety net
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: "An account with this email already exists" })
        }
        console.error("[registerUser]", error)
        return res.status(500).json({ success: false, message: "Registration failed. Please try again." })
    }
}

// ─── Login User ───────────────────────────────────────────────────────────────
export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email: email.toLowerCase().trim() })

        // Use a consistent error message to prevent user enumeration
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid email or password" })
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Invalid email or password" })
        }

        const token = generateToken(user._id)
        return res.json({ success: true, token })

    } catch (error) {
        console.error("[loginUser]", error)
        return res.status(500).json({ success: false, message: "Login failed. Please try again." })
    }
}

// ─── Get User Data ────────────────────────────────────────────────────────────
export const getUser = async (req, res) => {
    try {
        // req.user is already set by auth middleware
        if (!req.user) {
            return res.status(401).json({ success: false, message: "Not authorized" })
        }
        return res.json({ success: true, user: req.user })
    } catch (error) {
        console.error("[getUser]", error)
        return res.status(500).json({ success: false, message: "Failed to fetch user data. Please try again." })
    }
}

// ─── Get Published Images ─────────────────────────────────────────────────────
export const getPublishedImages = async (req, res) => {
    try {
        const publishedImageMessages = await Chat.aggregate([
            { $unwind: "$messages" },
            {
                $match: {
                    "messages.isImage": true,
                    "messages.isPublished": true
                }
            },
            {
                $project: {
                    _id: 0,
                    imageUrl: "$messages.content",
                    userName: "$userName"
                }
            }
        ])
        return res.json({ success: true, images: publishedImageMessages.reverse() })
    } catch (error) {
        console.error("[getPublishedImages]", error)
        return res.status(500).json({ success: false, message: "Failed to load community images." })
    }
}

// ─── Update Theme ─────────────────────────────────────────────────────────────
export const updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;
        if (!theme || !['light', 'dark'].includes(theme)) {
            return res.status(400).json({ success: false, message: "Invalid theme value. Must be 'light' or 'dark'." })
        }
        const result = await User.updateOne({ _id: req.user._id }, { theme })
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: "User not found" })
        }
        return res.json({ success: true, message: "Theme updated" })
    } catch (error) {
        console.error("[updateTheme]", error)
        return res.status(500).json({ success: false, message: "Failed to save theme preference." })
    }
}