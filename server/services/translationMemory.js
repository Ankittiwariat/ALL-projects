/**
 * Level 1 — Translation Memory Service
 *
 * Provides instant lookup and async caching of completed translations.
 * On a cache hit, the pipeline short-circuits — zero AI cost.
 *
 * Minimum confidence threshold for caching: 70 (configurable via env)
 */

import TranslationMemory, { makeSourceHash } from '../models/TranslationMemory.js';

const MIN_CACHE_CONFIDENCE = parseInt(process.env.TRANSLATION_MEMORY_MIN_CONFIDENCE || '70', 10);

/**
 * Look up a translation in memory.
 * @returns {Promise<{ targetText: string, confidence: number, responseLevel: number }|null>}
 */
export async function lookupTranslationMemory(text, direction) {
    try {
        const hash = makeSourceHash(text, direction);
        const entry = await TranslationMemory.findOneAndUpdate(
            { sourceHash: hash },
            { $inc: { usageCount: 1 } },
            { new: true }
        ).lean();

        if (!entry) return null;

        return {
            targetText: entry.targetText,
            confidence: entry.confidence,
            responseLevel: entry.responseLevel,
            fromMemory: true,
        };
    } catch (err) {
        // Memory lookup failure is non-fatal
        console.error('[TranslationMemory.lookup]', err.message);
        return null;
    }
}

/**
 * Asynchronously cache a translation result.
 * Only caches if confidence >= MIN_CACHE_CONFIDENCE.
 * Non-blocking — call with .catch(() => {})
 */
export async function cacheTranslation(text, targetText, direction, confidence, responseLevel) {
    if (confidence < MIN_CACHE_CONFIDENCE) return;

    try {
        const hash = makeSourceHash(text, direction);
        await TranslationMemory.findOneAndUpdate(
            { sourceHash: hash },
            {
                $set: { sourceText: text, targetText, direction, confidence, responseLevel },
                $setOnInsert: { usageCount: 0 },
            },
            { upsert: true }
        );
    } catch (err) {
        // Cache write failure is non-fatal
        console.error('[TranslationMemory.cache]', err.message);
    }
}
