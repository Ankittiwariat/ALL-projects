import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * TranslationMemory — Level 1 Cache
 *
 * Stores approved translation results so identical (or near-identical)
 * inputs are returned instantly without any AI call.
 *
 * Lookup key: SHA256(normalizedInput + ':' + direction)
 */
const translationMemorySchema = new mongoose.Schema(
    {
        // SHA256 hash of normalizedSourceText + ':' + direction
        // Used as the primary lookup key — O(1) indexed lookup
        sourceHash: { type: String, required: true, unique: true, index: true },

        // Original input text (for debugging / admin review)
        sourceText: { type: String, required: true },

        // Final translated output
        targetText: { type: String, required: true },

        // 'tv_to_en' | 'en_to_tv'
        direction: { type: String, required: true, enum: ['tv_to_en', 'en_to_tv'], index: true },

        // Confidence score (0-100) computed by ConfidenceScorer at time of creation
        confidence: { type: Number, default: 0, min: 0, max: 100 },

        // Which pipeline level produced this result
        // 1=exact phrase, 1.5=fuzzy phrase, 2=bilingual RAG, 2.5=dict+partial RAG, 3=AI only
        responseLevel: { type: Number, default: 2 },

        // How many times this cached entry has been served
        usageCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

/**
 * Utility: generate the lookup hash from raw input text + direction
 */
export function makeSourceHash(text, direction) {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(`${normalized}:${direction}`).digest('hex');
}

const TranslationMemory = mongoose.model('TranslationMemory', translationMemorySchema);
export default TranslationMemory;
