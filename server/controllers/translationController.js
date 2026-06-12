/**
 * Translation Controller — God Mode v2
 *
 * Thin orchestrator. All business logic lives in server/services/.
 *
 * Pipeline:
 *  [L0] Language Guard
 *  [L1] Translation Memory
 *  [L2] PhrasePair Engine (Exact → Fuzzy → N-gram)
 *  [L3] Bilingual RAG Engine    ← parallel
 *  [L4] Dictionary Engine       ← parallel
 *  [L5] Context Builder
 *  [L6] GPT-4o Reconstruction Engine
 *  [L6.5] Output Validator (retry once if invalid)
 *  [L7] Confidence Scorer
 *  [ASYNC] Cache to Translation Memory
 */

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Chat from '../models/Chat.js';

import { checkLanguageGuard }                   from '../services/languageGuard.js';
import { lookupTranslationMemory, cacheTranslation } from '../services/translationMemory.js';
import { runPhrasePairEngine, fetchRelatedPairs }    from '../services/phrasePairEngine.js';
import { runBilingualRag }                      from '../services/bilingualRagEngine.js';
import { runDictionaryEngine }                  from '../services/dictionaryEngine.js';
import { buildContext }                         from '../services/contextBuilder.js';
import { reconstruct, reconstructStream }       from '../services/reconstructionEngine.js';
import { validateOutput }                       from '../services/outputValidator.js';
import { computeConfidence }                    from '../services/confidenceScorer.js';

const CREDITS_COST = 1;

function countWords(str) {
    return str.trim().split(/\s+/).length;
}

// ── Non-Streaming Controller ─────────────────────────────────────────────────
export const translateController = async (req, res) => {
    try {
        const userId = req.user._id;
        const { text, direction } = req.body;

        // [L0] Language Guard
        const guard = checkLanguageGuard(text, direction);

        // [L1] Translation Memory
        const memoryHit = await lookupTranslationMemory(text, direction);
        if (memoryHit) {
            return res.json({
                success: true,
                translatedText: memoryHit.targetText,
                confidence: memoryHit.confidence,
                confidenceLabel: memoryHit.confidence >= 75 ? 'HIGH' : memoryHit.confidence >= 45 ? 'MODERATE' : 'LOW',
                responseLevel: memoryHit.responseLevel,
                fromMemory: true,
                directionMismatch: guard.mismatch,
                detectedLang: guard.detectedLang,
            });
        }

        // [L2] PhrasePair Engine
        const phraseMatch = await runPhrasePairEngine(text, direction);
        if (phraseMatch && phraseMatch.confidence === 1.0) {
            // Exact match — no credit deduction, return immediately
            return res.json({
                success: true,
                translatedText: phraseMatch.text,
                confidence: 100,
                confidenceLabel: 'HIGH',
                responseLevel: phraseMatch.level,
                sources: [{ source: phraseMatch.source, score: 1.0 }],
                directionMismatch: guard.mismatch,
                detectedLang: guard.detectedLang,
            });
        }

        // Deduct credit for AI call
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: CREDITS_COST } },
            { $inc: { credits: -CREDITS_COST } },
            { new: true }
        );
        if (!updatedUser) {
            return res.status(402).json({ success: false, message: 'Insufficient credits.' });
        }

        try {
            // [L3 + L4] Parallel: Bilingual RAG + Dictionary + Related Pairs
            const [ragChunks, dictEntries, relatedPairs] = await Promise.all([
                runBilingualRag(text, direction),
                runDictionaryEngine(text),
                fetchRelatedPairs(text),
            ]);

            // [L5] Context Builder
            const context = buildContext({ text, direction, phraseMatch, ragChunks, dictEntries, relatedPairs });

            // [L6] Reconstruction
            let translatedText = await reconstruct(context);
            if (!translatedText) throw new Error('Empty reconstruction output');

            // [L6.5] Output Validator
            let validation = validateOutput(translatedText, direction, text);
            if (!validation.valid) {
                // One retry
                const retry = await reconstruct(context);
                if (retry) {
                    translatedText = retry;
                    validation = validateOutput(translatedText, direction, text);
                }
            }

            // [L7] Confidence Score
            const { score: confidence, label: confidenceLabel, breakdown } = computeConfidence(context, validation);

            // [ASYNC] Cache to Translation Memory
            cacheTranslation(text, translatedText, direction, confidence, context.evidenceLevel === 'STRONG' ? 2 : 2.5)
                .catch(() => {});

            const responseLevel = !validation.valid ? 2.5 : context.evidenceLevel === 'STRONG' ? 2 : 3;

            return res.json({
                success: true,
                translatedText,
                confidence,
                confidenceLabel,
                responseLevel,
                evidenceLevel: context.evidenceLevel,
                sources: ragChunks.map(c => ({ source: c.source || c.chapter, score: c.hybridScore })),
                warnings: validation.warnings,
                directionMismatch: guard.mismatch,
                detectedLang: guard.detectedLang,
                creditsRemaining: updatedUser.credits,
            });

        } catch (aiErr) {
            await User.updateOne({ _id: userId }, { $inc: { credits: CREDITS_COST } });
            return res.status(502).json({ success: false, message: 'AI reconstruction failed.' });
        }

    } catch (error) {
        try { await User.updateOne({ _id: req.user._id }, { $inc: { credits: CREDITS_COST } }); } catch (_) {}
        console.error('[translateController]', error);
        return res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
    }
};

// ── Streaming Controller (SSE) ───────────────────────────────────────────────
export const streamTranslateController = async (req, res) => {
    const token     = req.query.token;
    const chatId    = req.query.chatId;
    const text      = req.query.text ? decodeURIComponent(req.query.text) : null;
    const direction = req.query.direction || 'tv_to_en';

    if (!token) return res.status(401).json({ success: false, message: 'Not authorized, no token' });

    let userId;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user    = await User.findById(decoded.id).select('-password');
        if (!user) return res.status(401).json({ success: false, message: 'Not authorized' });
        userId = user._id;
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (!chatId || !text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'chatId and text are required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
        const chat = await Chat.findOne({ _id: chatId, userId });
        if (!chat) {
            sendEvent('error', { message: 'Chat not found' });
            return res.end();
        }

        // [L0] Language Guard — send warning to client but do NOT block
        const guard = checkLanguageGuard(text, direction);
        if (guard.mismatch) {
            sendEvent('warning', {
                type: 'direction_mismatch',
                detectedLang: guard.detectedLang,
                message: `Input appears to be ${guard.detectedLang === 'tv' ? 'Tuvaluan' : 'English'} — check your direction toggle.`
            });
        }

        const directionLabel = direction === 'tv_to_en' ? '(Translate to English)' : '(Translate to Tuvaluan)';
        chat.messages.push({
            role: 'user',
            content: `**${directionLabel}**\n\n${text.trim()}`,
            timestamp: Date.now(),
            isImage: false,
        });

        // [L1] Translation Memory
        const memoryHit = await lookupTranslationMemory(text, direction);
        if (memoryHit) {
            // Stream from cache word-by-word for consistent UX
            const words = memoryHit.targetText.match(/(\S+\s*)/g) || [memoryHit.targetText];
            for (const word of words) {
                sendEvent('token', { token: word });
                await new Promise(r => setTimeout(r, 25));
            }
            const reply = {
                role: 'assistant', content: memoryHit.targetText, timestamp: Date.now(), isImage: false,
                responseLevel: memoryHit.responseLevel, confidence: memoryHit.confidence,
                confidenceLabel: memoryHit.confidence >= 75 ? 'HIGH' : 'MODERATE',
                fromMemory: true,
            };
            chat.messages.push(reply);
            if (chat.messages.length <= 2 && chat.name === 'New Chat') {
                chat.name = `Translate: ${text.trim().slice(0, 30)}`;
            }
            await chat.save();
            sendEvent('done', { chatName: chat.name, reply });
            return res.end();
        }

        // [L2] PhrasePair Engine
        const phraseMatch = await runPhrasePairEngine(text, direction);
        if (phraseMatch && phraseMatch.confidence === 1.0) {
            const words = phraseMatch.text.match(/(\S+\s*)/g) || [phraseMatch.text];
            for (const word of words) {
                sendEvent('token', { token: word });
                await new Promise(r => setTimeout(r, 25));
            }
            const reply = {
                role: 'assistant', content: phraseMatch.text, timestamp: Date.now(), isImage: false,
                responseLevel: phraseMatch.level, confidence: 100, confidenceLabel: 'HIGH',
            };
            chat.messages.push(reply);
            if (chat.messages.length <= 2 && chat.name === 'New Chat') {
                chat.name = `Translate: ${text.trim().slice(0, 30)}`;
            }
            await chat.save();
            sendEvent('done', { chatName: chat.name, reply });
            return res.end();
        }

        // Deduct credit for AI call
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: CREDITS_COST } },
            { $inc: { credits: -CREDITS_COST } },
            { new: true }
        );
        if (!updatedUser) {
            sendEvent('error', { message: 'Insufficient credits.' });
            return res.end();
        }

        // [L3 + L4] Parallel: Bilingual RAG + Dictionary + Related Pairs
        const [ragChunks, dictEntries, relatedPairs] = await Promise.all([
            runBilingualRag(text, direction),
            runDictionaryEngine(text),
            fetchRelatedPairs(text),
        ]);

        // [L5] Context Builder
        const context = buildContext({ text, direction, phraseMatch, ragChunks, dictEntries, relatedPairs });

        // [L6] GPT-4o Reconstruction (streaming)
        let fullText;
        try {
            fullText = await reconstructStream(context, (token) => sendEvent('token', { token }));
        } catch (aiErr) {
            await User.updateOne({ _id: userId }, { $inc: { credits: CREDITS_COST } });
            sendEvent('error', { message: 'AI reconstruction stream failed.' });
            return res.end();
        }

        if (!fullText) {
            await User.updateOne({ _id: userId }, { $inc: { credits: CREDITS_COST } });
            sendEvent('error', { message: 'Empty AI response.' });
            return res.end();
        }

        // [L6.5] Output Validator
        const validation = validateOutput(fullText, direction, text);

        // [L7] Confidence Score
        const { score: confidence, label: confidenceLabel } = computeConfidence(context, validation);

        // [ASYNC] Cache to Translation Memory
        const responseLevel = context.evidenceLevel === 'STRONG' ? 2 : context.evidenceLevel === 'MODERATE' ? 2.5 : 3;
        cacheTranslation(text, fullText, direction, confidence, responseLevel).catch(() => {});

        const reply = {
            role: 'assistant',
            content: fullText,
            timestamp: Date.now(),
            isImage: false,
            responseLevel,
            confidence,
            confidenceLabel,
            evidenceLevel: context.evidenceLevel,
            warnings: validation.warnings,
        };

        chat.messages.push(reply);
        if (chat.messages.length <= 2 && chat.name === 'New Chat') {
            chat.name = `Translate: ${text.trim().slice(0, 30)}`;
        }
        await chat.save();

        sendEvent('done', { chatName: chat.name, reply });
        res.end();

    } catch (err) {
        try { await User.updateOne({ _id: userId }, { $inc: { credits: CREDITS_COST } }); } catch (_) {}
        console.error('[streamTranslateController]', err);
        sendEvent('error', { message: 'Server error during stream.' });
        res.end();
    }
};
