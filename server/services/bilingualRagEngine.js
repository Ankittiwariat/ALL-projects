/**
 * Level 3 — Bilingual RAG Engine (THE CORE)
 *
 * Queries the `DocumentChunk` collection which holds 800 perfectly-aligned
 * bilingual chunks from the newDataset DOCX files (language='bilingual').
 *
 * Each chunk contains BOTH languages side-by-side:
 *   "Tuvaluan: A te laukele o te fenua...\nEnglish: Most of the land on Nanumea..."
 *
 * Strategy: Hybrid search = Vector (65%) + Keyword text (35%)
 *
 * PREREQUISITE: Atlas Vector Search index named `vector_index` must exist
 * on the `documentchunks` collection with cosine similarity, 1536 dims.
 */

import openai from '../configs/openai.js';
import DocumentChunk from '../models/DocumentChunk.js';

const EMBED_MODEL = 'text-embedding-3-small';
const VECTOR_CANDIDATES = 100;
const VECTOR_LIMIT = 15;
const FINAL_TOP_K = 5;
const VECTOR_WEIGHT = 0.65;
const TEXT_WEIGHT = 0.35;

async function embedText(text) {
    const response = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
    return response.data[0].embedding;
}

/**
 * Run vector search on DocumentChunk (bilingual chunks).
 */
async function vectorSearch(embedding) {
    try {
        // NOTE: filter on 'language' requires the Atlas vector index to include
        // a 'filter' field definition for 'language'. If not configured, remove the filter.
        const results = await DocumentChunk.aggregate([
            {
                $vectorSearch: {
                    index: 'vector_index',
                    path: 'embedding',
                    queryVector: embedding,
                    numCandidates: VECTOR_CANDIDATES,
                    limit: VECTOR_LIMIT,
                }
            },
            {
                $project: {
                    _id: 1, text: 1, source: 1, chapterId: 1, language: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);
        console.log(`[BilingualRAG] vectorSearch → ${results.length} results, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`);
        // Post-filter to bilingual only (in case index contains other language types)
        return results.filter(r => r.language === 'bilingual');
    } catch (err) {
        console.error('[BilingualRAG] vectorSearch error:', err.message);
        return [];
    }
}

/**
 * Run Atlas full-text search for keyword overlap.
 * Gracefully falls back if text index does not exist.
 */
async function textSearch(queryText) {
    try {
        const results = await DocumentChunk.aggregate([
            {
                $search: {
                    index: 'default',
                    text: {
                        query: queryText,
                        path: 'text',
                        fuzzy: { maxEdits: 1 }
                    }
                }
            },
            { $match: { language: 'bilingual' } },
            { $limit: VECTOR_LIMIT },
            {
                $project: {
                    _id: 1, text: 1, source: 1, chapterId: 1,
                    score: { $meta: 'searchScore' }
                }
            }
        ]);
        console.log(`[BilingualRAG] textSearch → ${results.length} results`);
        return results;
    } catch (err) {
        // Text index may not exist yet — silently return empty
        console.log(`[BilingualRAG] textSearch fallback (${err.message.slice(0, 60)})`);
        return [];
    }
}

/**
 * Parse the bilingual chunk text back into separate TV and EN parts.
 * Format expected: "Tuvaluan: ...\nEnglish: ..."
 */
function parseChunkText(rawText) {
    const tvMatch = rawText.match(/^Tuvaluan:\s*([\s\S]*?)(?=\nEnglish:|$)/i);
    const enMatch = rawText.match(/\nEnglish:\s*([\s\S]*)$/i);
    return {
        tvText: tvMatch ? tvMatch[1].trim() : rawText,
        enText: enMatch ? enMatch[1].trim() : '',
        rawText,
    };
}

/**
 * Main entry: Hybrid search returning top bilingual chunks.
 * @param {string} text - User input
 * @param {string} direction - 'tv_to_en' | 'en_to_tv'
 * @returns {Promise<Array<{ tvText, enText, source, chapterId, hybridScore }>>}
 */
export async function runBilingualRag(text, direction) {
    // For Tuvaluan input, prefix hint helps the embedding model
    const embeddingInput = direction === 'tv_to_en' ? `TUVALUAN: ${text}` : text;
    const embedding = await embedText(embeddingInput);

    // Run both searches in parallel
    const [vectorResults, textResults] = await Promise.all([
        vectorSearch(embedding),
        textSearch(text),
    ]);

    // Normalize text search scores to 0–1 range
    const maxTextScore = textResults.length > 0
        ? Math.max(...textResults.map(r => r.score || 0))
        : 1;

    // Build a map from document _id → merged score
    const scoreMap = new Map();

    for (const r of vectorResults) {
        const id = r._id.toString();
        scoreMap.set(id, {
            doc: r,
            vectorScore: r.score || 0,
            textScore: 0,
        });
    }

    for (const r of textResults) {
        const id = r._id.toString();
        const normalizedText = maxTextScore > 0 ? (r.score || 0) / maxTextScore : 0;
        if (scoreMap.has(id)) {
            scoreMap.get(id).textScore = normalizedText;
        } else {
            scoreMap.set(id, {
                doc: r,
                vectorScore: 0,
                textScore: normalizedText,
            });
        }
    }

    // Compute hybrid score and sort
    const merged = [...scoreMap.values()]
        .map(entry => ({
            ...parseChunkText(entry.doc.text),
            source: entry.doc.source,
            chapterId: entry.doc.chapterId,
            hybridScore: (entry.vectorScore * VECTOR_WEIGHT) + (entry.textScore * TEXT_WEIGHT),
            vectorScore: entry.vectorScore,
        }))
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, FINAL_TOP_K);

    return merged;
}

/**
 * Get top hybrid score from the results (used for confidence scoring).
 */
export function getTopRagScore(chunks) {
    if (!chunks || chunks.length === 0) return 0;
    return chunks[0].hybridScore || 0;
}
