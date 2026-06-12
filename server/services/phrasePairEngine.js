/**
 * Level 2 — PhrasePair Engine
 *
 * Three-tier lookup for phrase-level translation:
 *   Tier A: Exact DB match (100% confidence)
 *   Tier B: Fuse.js fuzzy match (threshold 0.15)
 *   Tier C: N-gram segmentation — splits long input into bigrams/trigrams
 *           and checks each segment, so "How are you today?" hits "How are you?"
 *
 * Cost: Zero (in-memory Fuse.js + indexed MongoDB queries)
 */

import Fuse from 'fuse.js';
import PhrasePair from '../models/PhrasePair.js';

// ── In-Memory Fuzzy Index ────────────────────────────────────────────────────
let fuzzyIndex = null;
let phraseData = [];
let indexLoadedAt = 0;
const INDEX_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function initPhrasePairIndex(forceRefresh = false) {
    const stale = Date.now() - indexLoadedAt > INDEX_TTL_MS;
    if (fuzzyIndex && !forceRefresh && !stale) return;

    try {
        phraseData = await PhrasePair.find({}).lean();
        fuzzyIndex = new Fuse(phraseData, {
            keys: ['normalizedEn', 'normalizedTv'],
            includeScore: true,
            threshold: 0.2,
        });
        indexLoadedAt = Date.now();
        console.log(`[PhrasePairEngine] Index loaded: ${phraseData.length} pairs`);
    } catch (e) {
        console.error('[PhrasePairEngine] Failed to init index', e);
    }
}

// Initialize on module load
initPhrasePairIndex();

// ── Tier A: Exact DB match ───────────────────────────────────────────────────
async function exactMatch(text, direction) {
    const isToEnglish = direction === 'tv_to_en';
    const normalized = normalizeText(text);
    if (!normalized || normalized.length < 2) return null;

    const query = isToEnglish ? { normalizedTv: normalized } : { normalizedEn: normalized };
    const match = await PhrasePair.findOne(query).lean();
    if (!match) return null;

    PhrasePair.updateOne({ _id: match._id }, { $inc: { usageCount: 1 } }).exec();
    return {
        text: isToEnglish ? match.english : match.tuvaluan,
        source: match.source,
        confidence: 1.0,
        level: 1,
        type: 'exact',
    };
}

// ── Tier B: Fuzzy match ──────────────────────────────────────────────────────
async function fuzzyMatch(text, direction) {
    if (!fuzzyIndex) await initPhrasePairIndex();
    if (!fuzzyIndex) return null;

    const normalized = normalizeText(text);
    if (!normalized || normalized.length < 5) return null;

    const results = fuzzyIndex.search(normalized);
    if (!results.length || results[0].score > 0.15) return null;

    const best = results[0];
    const isToEnglish = direction === 'tv_to_en';
    PhrasePair.updateOne({ _id: best.item._id }, { $inc: { usageCount: 1 } }).exec();

    return {
        text: isToEnglish ? best.item.english : best.item.tuvaluan,
        source: best.item.source,
        confidence: parseFloat((1.0 - best.score).toFixed(3)),
        level: 1.5,
        type: 'fuzzy',
    };
}

// ── Tier C: N-gram segmentation ──────────────────────────────────────────────
async function ngramMatch(text, direction) {
    if (!fuzzyIndex) await initPhrasePairIndex();
    if (!fuzzyIndex) return null;

    const tokens = normalizeText(text).split(/\s+/);
    if (tokens.length < 3) return null; // only useful for longer inputs

    const segments = [];
    // Trigrams
    for (let i = 0; i <= tokens.length - 3; i++) {
        segments.push(tokens.slice(i, i + 3).join(' '));
    }
    // Bigrams
    for (let i = 0; i <= tokens.length - 2; i++) {
        segments.push(tokens.slice(i, i + 2).join(' '));
    }

    let bestResult = null;
    let bestScore = Infinity;

    for (const seg of segments) {
        const results = fuzzyIndex.search(seg);
        if (results.length && results[0].score < bestScore && results[0].score <= 0.15) {
            bestScore = results[0].score;
            const isToEnglish = direction === 'tv_to_en';
            bestResult = {
                text: isToEnglish ? results[0].item.english : results[0].item.tuvaluan,
                source: results[0].item.source,
                confidence: parseFloat((1.0 - results[0].score).toFixed(3)),
                level: 1.5,
                type: 'ngram_fuzzy',
            };
        }
    }
    return bestResult;
}

/**
 * Main entry point for Level 2.
 * @returns {Promise<{ text, source, confidence, level, type }|null>}
 */
export async function runPhrasePairEngine(text, direction) {
    // Tier A
    const exact = await exactMatch(text, direction);
    if (exact) return exact;

    // Tier B (only for short text)
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount < 20) {
        const fuzzy = await fuzzyMatch(text, direction);
        if (fuzzy) return fuzzy;
    }

    // Tier C
    const ngram = await ngramMatch(text, direction);
    return ngram;
}

/**
 * Fetch related phrase pairs for context injection into prompts.
 * Used by contextBuilder to enrich the RAG context.
 */
export async function fetchRelatedPairs(text, limit = 12) {
    if (!fuzzyIndex) await initPhrasePairIndex();
    if (!phraseData.length) return [];

    const normalized = normalizeText(text);
    const results = fuzzyIndex.search(normalized, { limit });
    const seen = new Set();
    const pairs = [];
    for (const r of results) {
        const id = r.item._id.toString();
        if (!seen.has(id)) {
            seen.add(id);
            pairs.push(r.item);
        }
    }
    return pairs;
}
