import Chat from "../models/Chat.js"

// ─── Create Chat ──────────────────────────────────────────────────────────────
export const createChat = async (req, res) => {
    try {
        const userId = req.user._id

        if (!req.user.name) {
            return res.status(400).json({ success: false, message: "User profile incomplete" })
        }

        // Prevent chat spam — limit to 50 active chats per user
        const chatCount = await Chat.countDocuments({ userId })
        if (chatCount >= 50) {
            return res.status(429).json({
                success: false,
                message: "Chat limit reached (50 max). Please delete some old chats to continue."
            })
        }

        const chat = await Chat.create({
            userId,
            messages: [],
            name: "New Chat",
            userName: req.user.name
        })

        return res.status(201).json({ success: true, message: "Chat created", chat })

    } catch (error) {
        console.error("[createChat]", error)
        return res.status(500).json({ success: false, message: "Failed to create chat. Please try again." })
    }
}

// ─── Get All Chats ────────────────────────────────────────────────────────────
export const getChats = async (req, res) => {
    try {
        const userId = req.user._id
        const chats = await Chat.find({ userId }).sort({ updatedAt: -1 })
        return res.json({ success: true, chats })
    } catch (error) {
        console.error("[getChats]", error)
        return res.status(500).json({ success: false, message: "Failed to load chats. Please refresh." })
    }
}

// ─── Delete Chat ──────────────────────────────────────────────────────────────
export const deleteChat = async (req, res) => {
    try {
        const userId = req.user._id
        const { chatId } = req.body

        // Verify the chat belongs to this user before deleting
        const chat = await Chat.findOne({ _id: chatId, userId })
        if (!chat) {
            return res.status(404).json({ success: false, message: "Chat not found or access denied" })
        }

        await Chat.deleteOne({ _id: chatId, userId })

        return res.json({ success: true, message: "Chat deleted successfully" })

    } catch (error) {
        console.error("[deleteChat]", error)
        return res.status(500).json({ success: false, message: "Failed to delete chat. Please try again." })
    }
}