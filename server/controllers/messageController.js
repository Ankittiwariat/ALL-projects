import axios from "axios"
import Chat from "../models/Chat.js"
import User from "../models/User.js"
import imagekit from "../configs/imageKit.js"
import openai from '../configs/openai.js'
import jwt from 'jsonwebtoken'

// ─── Text Message Controller ──────────────────────────────────────────────────
export const textMessageController = async (req, res) => {
    try {
        const userId = req.user._id
        const { chatId, prompt } = req.body

        // Guard: chatId and prompt already validated by Zod middleware,
        // but double-check prompt is non-empty after trim
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, message: "Prompt cannot be empty" })
        }

        // 1. Atomic credit check + deduct — no race condition
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: 1 } },
            { $inc: { credits: -1 } },
            { new: true }
        )

        if (!updatedUser) {
            return res.status(402).json({
                success: false,
                message: "Insufficient credits. Please purchase more credits to continue."
            })
        }

        // 2. Verify chat belongs to this user
        const chat = await Chat.findOne({ _id: chatId, userId })
        if (!chat) {
            // Refund credit — chat not found or doesn't belong to user
            await User.updateOne({ _id: userId }, { $inc: { credits: 1 } })
            return res.status(404).json({ success: false, message: "Chat not found or access denied" })
        }

        // 3. Push user message
        chat.messages.push({
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
            isImage: false
        })

        // 4. Call AI
        let choices
        try {
            const response = await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                messages: [{ role: "user", content: prompt.trim() }],
            })
            choices = response.choices
        } catch (aiError) {
            // Refund credit on AI failure
            await User.updateOne({ _id: userId }, { $inc: { credits: 1 } })
            const aiMsg = aiError?.status === 429
                ? "AI service is currently overloaded. Please try again in a moment."
                : aiError?.status === 503
                    ? "AI service is temporarily unavailable. Please try again later."
                    : "Failed to get a response from AI. Please try again."
            return res.status(502).json({ success: false, message: aiMsg })
        }

        if (!choices || choices.length === 0) {
            await User.updateOne({ _id: userId }, { $inc: { credits: 1 } })
            return res.status(502).json({ success: false, message: "AI returned an empty response. Please try again." })
        }

        // 5. Push AI reply
        const reply = { ...choices[0].message, timestamp: Date.now(), isImage: false }
        chat.messages.push(reply)

        // 6. Auto-name chat after first exchange
        if (chat.messages.length <= 2 && chat.name === "New Chat") {
            chat.name = prompt.trim().slice(0, 50) || "New Chat"
        }

        await chat.save()

        return res.json({ success: true, reply, chatName: chat.name })

    } catch (error) {
        // Attempt credit refund on unexpected error — best-effort
        try {
            await User.updateOne({ _id: req.user._id }, { $inc: { credits: 1 } })
        } catch (_) { /* silent — refund failure should not override original error */ }

        console.error("[textMessageController]", error)
        return res.status(500).json({ success: false, message: "An unexpected error occurred. Please try again." })
    }
}

// ─── Streaming Text Message Controller (SSE) ──────────────────────────────────
export const streamTextMessageController = async (req, res) => {
    // SSE requires GET; auth token comes via query param since EventSource can't set headers
    const token = req.query.token
    const chatId = req.query.chatId
    const prompt = req.query.prompt ? decodeURIComponent(req.query.prompt) : null

    // ── Auth ──────────────────────────────────────────────────────────────────
    if (!token) {
        return res.status(401).json({ success: false, message: "Not authorized, no token provided" })
    }
    let userId
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(decoded.id).select('-password')
        if (!user) return res.status(401).json({ success: false, message: "Not authorized, user not found" })
        userId = user._id
    } catch {
        return res.status(401).json({ success: false, message: "Not authorized, invalid token" })
    }

    if (!chatId || !prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, message: "chatId and prompt are required" })
    }

    // ── SSE headers ───────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering
    res.flushHeaders()

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
        // 1. Atomic credit deduction
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: 1 } },
            { $inc: { credits: -1 } },
            { new: true }
        )
        if (!updatedUser) {
            sendEvent('error', { message: "Insufficient credits. Please purchase more credits to continue." })
            return res.end()
        }

        // 2. Verify chat ownership
        const chat = await Chat.findOne({ _id: chatId, userId })
        if (!chat) {
            await User.updateOne({ _id: userId }, { $inc: { credits: 1 } })
            sendEvent('error', { message: "Chat not found or access denied" })
            return res.end()
        }

        // 3. Push user message
        chat.messages.push({
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
            isImage: false
        })

        // 4. Open OpenAI stream
        let stream
        try {
            stream = await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                messages: [{ role: "user", content: prompt.trim() }],
                stream: true,
            })
        } catch (aiError) {
            await User.updateOne({ _id: userId }, { $inc: { credits: 1 } })
            const aiMsg = aiError?.status === 429
                ? "AI service is currently overloaded. Please try again in a moment."
                : "Failed to get a response from AI. Please try again."
            sendEvent('error', { message: aiMsg })
            return res.end()
        }

        // 5. Stream tokens to client
        let fullContent = ''
        for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) {
                fullContent += delta
                sendEvent('token', { token: delta })
            }
        }

        // 6. Save full AI reply to DB
        const reply = {
            role: 'assistant',
            content: fullContent,
            timestamp: Date.now(),
            isImage: false
        }
        chat.messages.push(reply)

        // 7. Auto-name chat
        if (chat.messages.length <= 2 && chat.name === "New Chat") {
            chat.name = prompt.trim().slice(0, 50) || "New Chat"
        }
        await chat.save()

        // 8. Signal completion
        sendEvent('done', { chatName: chat.name, reply })
        res.end()

    } catch (error) {
        try { await User.updateOne({ _id: userId }, { $inc: { credits: 1 } }) } catch (_) {}
        console.error("[streamTextMessageController]", error)
        sendEvent('error', { message: "An unexpected error occurred. Please try again." })
        res.end()
    }
}

// ─── Image Message Controller ─────────────────────────────────────────────────
export const imageMessageController = async (req, res) => {
    try {
        const userId = req.user._id
        const { prompt, chatId, isPublished } = req.body

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, message: "Prompt cannot be empty" })
        }

        // 1. Atomic credit check (2 credits for image)
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: 2 } },
            { $inc: { credits: -2 } },
            { new: true }
        )

        if (!updatedUser) {
            return res.status(402).json({
                success: false,
                message: "Insufficient credits. Image generation requires 2 credits."
            })
        }

        // 2. Verify chat belongs to this user
        const chat = await Chat.findOne({ _id: chatId, userId })
        if (!chat) {
            await User.updateOne({ _id: userId }, { $inc: { credits: 2 } })
            return res.status(404).json({ success: false, message: "Chat not found or access denied" })
        }

        // 3. Push user message
        chat.messages.push({
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
            isImage: false
        })

        // 4. Generate image
        let uploadResponse
        try {
            const encodedPrompt = encodeURIComponent(prompt.trim())
            const generatedImageUrl = `${process.env.IMAGEKIT_URL_ENDPOINT}/ik-genimg-prompt-${encodedPrompt}/te_tuvalu_gpt/${Date.now()}.png?tr=w-800,h-800`
            const aiImageResponse = await axios.get(generatedImageUrl, {
                responseType: "arraybuffer",
                timeout: 30000 // 30s timeout
            })
            const base64Image = `data:image/png;base64,${Buffer.from(aiImageResponse.data, "binary").toString('base64')}`
            uploadResponse = await imagekit.upload({
                file: base64Image,
                fileName: `${Date.now()}.png`,
                folder: "te_tuvalu_gpt"
            })
        } catch (imgError) {
            await User.updateOne({ _id: userId }, { $inc: { credits: 2 } })
            const imgMsg = imgError.code === 'ECONNABORTED'
                ? "Image generation timed out. Please try again."
                : imgError.response?.status === 429
                    ? "Image service is overloaded. Please try again in a moment."
                    : "Failed to generate image. Please try again."
            return res.status(502).json({ success: false, message: imgMsg })
        }

        // 5. Push AI reply
        const reply = {
            role: 'assistant',
            content: uploadResponse.url,
            timestamp: Date.now(),
            isImage: true,
            isPublished: Boolean(isPublished)
        }
        chat.messages.push(reply)

        // 6. Auto-name chat after first exchange
        if (chat.messages.length <= 2 && chat.name === "New Chat") {
            chat.name = prompt.trim().slice(0, 50) || "New Chat"
        }

        await chat.save()

        return res.json({ success: true, reply, chatName: chat.name })

    } catch (error) {
        try {
            await User.updateOne({ _id: req.user._id }, { $inc: { credits: 2 } })
        } catch (_) { /* silent */ }

        console.error("[imageMessageController]", error)
        return res.status(500).json({ success: false, message: "An unexpected error occurred. Please try again." })
    }
}