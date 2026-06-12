/**
 * Level 4 — Dictionary Intelligence Engine
 *
 * Upgraded from the old translationController dictionary logic.
 *
 * Key improvements:
 *  - Compound phrase priority: "Holy Spirit" is searched as one unit,
 *    not split into "Holy" + "Spirit"
 *  - Priority order: Full phrase > Trigrams > Bigrams > Single words
 *  - Stop-word filtering on single-word lookups
 *  - Parallel embedding + vector search for all query candidates
 *
 * Runs PARALLEL with Level 3 (bilingualRagEngine) for minimal latency.
 */

import openai from '../configs/openai.js';
import DictionaryEntry from '../models/DictionaryEntry.js';

const EMBED_MODEL = 'text-embedding-3-small';
const DICT_K = 3;
const MIN_VECTOR_SCORE = 0.65;

// English stop words — filtered before single-word lookup
const STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','shall','should',
    'may','might','must','can','could','this','that','these','those',
    'i','my','your','his','her','its','our','their','me','him',
    'us','them','and','or','but','in','on','at','to','for','of','with',
    'by','from','into','it','not','no','so','if','as','up','out','about',
    'what','when','where','who','how','all','just','than','then','too',
    'very','s','t','am','there','here','we','they','he','she','you'
]);

/**
 * Main entry point for Level 4.
 * @param {string} text - User input
 * @returns {Promise<Array<{ headword, definition, partOfSpeech, examples, score }>>}
 */
export async function runDictionaryEngine(text) {
    try {
        const cleaned = text.toLowerCase().replace(/[^a-zāēīōū\s]/gi, ' ').trim();
        const allTokens = cleaned.split(/\s+/).filter(Boolean);

        if (allTokens.length === 0) return [];

        // ── Compound phrase priority ──────────────────────────────────────────
        // Full phrase first (if short input)
        const fullPhrase = allTokens.length <= 6 ? [cleaned] : [];

        // Trigrams
        const trigrams = [];
        for (let i = 0; i <= allTokens.length - 3; i++) {
            trigrams.push(`${allTokens[i]} ${allTokens[i+1]} ${allTokens[i+2]}`);
        }

        // Bigrams
        const bigrams = [];
        for (let i = 0; i <= allTokens.length - 2; i++) {
            bigrams.push(`${allTokens[i]} ${allTokens[i+1]}`);
        }

        // Single meaningful words (stop-word filtered)
        const singleWords = [...new Set(
            allTokens.filter(w => w.length > 2 && !STOP_WORDS.has(w))
        )];

        // Priority order: full phrase > trigrams > bigrams > words
        const allQueries = [...new Set([
            ...fullPhrase,
            ...trigrams,
            ...bigrams,
            ...singleWords,
        ])];

        if (allQueries.length === 0) return [];

        // Batch embed all queries in one OpenAI call
        const embResponse = await openai.embeddings.create({
            model: EMBED_MODEL,
            input: allQueries,
        });
        const queryEmbeddings = embResponse.data
            .sort((a, b) => a.index - b.index)
            .map(e => e.embedding);

        // Vector search for every query in parallel
        const searchPromises = allQueries.map((_, idx) =>
            DictionaryEntry.aggregate([
                {
                    $vectorSearch: {
                        index: 'dictionary_vector_index',
                        path: 'embedding',
                        queryVector: queryEmbeddings[idx],
                        numCandidates: DICT_K * 15,
                        limit: DICT_K,
                    }
                },
                {
                    $project: {
                        headword: 1, language: 1, definition: 1,
                        partOfSpeech: 1, examples: 1,
                        score: { $meta: 'vectorSearchScore' }
                    }
                }
            ])
        );

        const allResults = await Promise.all(searchPromises);

        // Deduplicate and format results
        // Dictionary format: headword=English, definition=Tuvaluan
        // For tv_to_en: user provides Tuvaluan → we find closest EN headword → return EN definition context
        // For en_to_tv: user provides English → we find EN headword → definition IS the Tuvaluan word
        const seen = new Set();
        const entries = [];
        for (const results of allResults) {
            for (const r of results) {
                if ((r.score || 0) < MIN_VECTOR_SCORE) continue;
                const key = r.headword.toLowerCase().trim();
                if (!seen.has(key)) {
                    seen.add(key);
                    entries.push(r);
                }
            }
        }

        return entries.sort((a, b) => (b.score || 0) - (a.score || 0));

    } catch (err) {
        console.error('[DictionaryEngine]', err.message);
        return [];
    }
}
