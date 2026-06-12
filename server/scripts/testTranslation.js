/**
 * Deep Translation Test Script
 * Tests ALL levels: 1, 1.5, 2, 2.5, 3
 * Runs directly against MongoDB + OpenAI — bypasses HTTP auth requirement
 *
 * Usage: node scripts/testTranslation.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import Fuse from 'fuse.js';
import PhrasePair from '../models/PhrasePair.js';
import ChapterChunk from '../models/ChapterChunk.js';
import DictionaryEntry from '../models/DictionaryEntry.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL  = 'text-embedding-3-small';
const CONTEXT_K    = 5;
const DICT_K       = 3;

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

// ── Colours for terminal output ───────────────────────────────────────────────
const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    red:    '\x1b[31m',
    blue:   '\x1b[34m',
    magenta:'\x1b[35m',
    grey:   '\x1b[90m',
};

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?\"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function countWords(str) { return str.trim().split(/\s+/).length; }

// ── Level 1: Exact ─────────────────────────────────────────────────────────────
async function findExactPhrase(text, direction) {
    const isToEn   = direction === 'tv_to_en';
    const normalized = normalizeText(text);
    if (!normalized || normalized.length < 2) return null;
    const query = isToEn ? { normalizedTv: normalized } : { normalizedEn: normalized };
    return await PhrasePair.findOne(query).lean();
}

// ── Level 1.5: Fuzzy ───────────────────────────────────────────────────────────
async function findFuzzyPhrase(text, phraseData) {
    const fuse = new Fuse(phraseData, {
        keys: ['normalizedEn', 'normalizedTv'],
        includeScore: true,
        threshold: 0.2,
    });
    const normalized = normalizeText(text);
    if (!normalized || normalized.length < 5) return null;
    const results = fuse.search(normalized);
    if (results.length > 0 && results[0].score <= 0.15) return results[0];
    return null;
}

// ── Level 2: Chapter RAG ───────────────────────────────────────────────────────
async function retrieveChapters(text, direction) {
    const embeddingInput = direction === 'tv_to_en' ? 'TUVALUAN: ' + text : text;
    const r = await openai.embeddings.create({ model: EMBED_MODEL, input: embeddingInput });
    const embedding = r.data[0].embedding;
    const pipeline = [
        { $vectorSearch: { index: 'chapter_vector_index', path: 'embedding', queryVector: embedding, numCandidates: CONTEXT_K * 10, limit: CONTEXT_K } },
        { $project: { chapterId: 1, language: 1, fullText: 1, alignedFullText: 1, source: 1, score: { $meta: 'vectorSearchScore' } } }
    ];
    return await ChapterChunk.aggregate(pipeline);
}

// ── Level 2.5: Dictionary ─────────────────────────────────────────────────────
async function fetchDictionaryEntries(text) {
    const cleaned   = text.toLowerCase().replace(/[^a-zāēīōū\s]/gi, ' ').trim();
    const allTokens = cleaned.split(/\s+/).filter(Boolean);

    const singleWords = [...new Set(allTokens.filter(w => w.length > 2 && !STOP_WORDS.has(w)))];
    const bigrams  = [];
    const trigrams = [];
    for (let i = 0; i < allTokens.length - 1; i++) bigrams.push(`${allTokens[i]} ${allTokens[i+1]}`);
    for (let i = 0; i < allTokens.length - 2; i++) trigrams.push(`${allTokens[i]} ${allTokens[i+1]} ${allTokens[i+2]}`);
    const allQueries = [...new Set([...singleWords, ...bigrams, ...trigrams, ...(allTokens.length <= 6 ? [cleaned] : [])])];

    if (allQueries.length === 0) return [];

    const embResponse = await openai.embeddings.create({ model: EMBED_MODEL, input: allQueries });
    const queryEmbeddings = embResponse.data.sort((a, b) => a.index - b.index).map(e => e.embedding);

    const searchPromises = allQueries.map((q, idx) =>
        DictionaryEntry.aggregate([
            { $vectorSearch: { index: 'dictionary_vector_index', path: 'embedding', queryVector: queryEmbeddings[idx], numCandidates: DICT_K * 15, limit: DICT_K } },
            { $project: { headword: 1, language: 1, definition: 1, partOfSpeech: 1, examples: 1, score: { $meta: 'vectorSearchScore' } } }
        ])
    );
    const allResults = await Promise.all(searchPromises);

    const seen = new Set();
    const entries = [];
    for (const results of allResults) {
        for (const r of results) {
            if ((r.score || 0) < 0.65) continue;
            const key = r.headword.toLowerCase().trim();
            if (!seen.has(key)) { seen.add(key); entries.push(r); }
        }
    }
    return entries.sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ── Test Runner ────────────────────────────────────────────────────────────────
async function runTest(testCase, phraseData, idx) {
    const { input, direction, description, expectLevel } = testCase;
    const isToEn  = direction === 'tv_to_en';
    const dirLabel = isToEn ? 'TV → EN' : 'EN → TV';

    console.log(`\n${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log(`${C.bold}Test ${idx+1}: ${description}${C.reset}  ${C.grey}[${dirLabel}]${C.reset}`);
    console.log(`${C.bold}Input:${C.reset} "${input}"`);
    console.log(`${C.grey}Expected Level: ${expectLevel}${C.reset}`);

    const wordCount = countWords(input);

    // ── Level 1: Exact ──────────────────────────────────────────────────────
    if (wordCount < 20) {
        const exact = await findExactPhrase(input, direction);
        if (exact) {
            const result = isToEn ? exact.english : exact.tuvaluan;
            console.log(`${C.green}${C.bold}  ✅ Level 1 (EXACT MATCH)${C.reset}`);
            console.log(`  Source: ${exact.source}`);
            console.log(`  ${C.bold}Result:${C.reset} "${result}"`);
            return { level: 1, result };
        }
    }

    // ── Level 1.5: Fuzzy ────────────────────────────────────────────────────
    if (wordCount < 20) {
        const fuzzy = await findFuzzyPhrase(input, phraseData);
        if (fuzzy) {
            const result = isToEn ? fuzzy.item.english : fuzzy.item.tuvaluan;
            console.log(`${C.yellow}${C.bold}  ✅ Level 1.5 (FUZZY MATCH)${C.reset}  score=${fuzzy.score?.toFixed(4)}`);
            console.log(`  Source: ${fuzzy.item.source}`);
            console.log(`  ${C.bold}Result:${C.reset} "${result}"`);
            return { level: 1.5, result };
        }
    }

    // ── Level 2/2.5/3: RAG + Dictionary ────────────────────────────────────
    const chapters = await retrieveChapters(input, direction);
    const maxScore  = chapters.length > 0 ? chapters[0].score : 0;
    const useFallback = maxScore < 0.75;

    let dictEntries = [];
    if (useFallback) {
        dictEntries = await fetchDictionaryEntries(input);
    }

    const resolvedLevel = !useFallback ? 2 : dictEntries.length > 0 ? 2.5 : 3;

    if (!useFallback) {
        console.log(`${C.blue}${C.bold}  ✅ Level 2 (CHAPTER RAG)${C.reset}  vectorScore=${maxScore.toFixed(4)}`);
        console.log(`  Top chapter: ${chapters[0]?.chapterId} | source: ${chapters[0]?.source}`);
    } else if (dictEntries.length > 0) {
        console.log(`${C.magenta}${C.bold}  ✅ Level 2.5 (DICTIONARY)${C.reset}  vectorScore=${maxScore.toFixed(4)} | ${dictEntries.length} dict entries`);
        console.log(`  ${C.grey}Dictionary hits:${C.reset}`);
        dictEntries.slice(0, 5).forEach(e => {
            console.log(`    ${C.yellow}[${e.headword}]${C.reset} (${e.partOfSpeech||'?'}) — ${e.definition}  ${C.grey}score=${e.score?.toFixed(4)}${C.reset}`);
        });
    } else {
        console.log(`${C.red}${C.bold}  ⚠️  Level 3 (FALLBACK LLM)${C.reset}  vectorScore=${maxScore.toFixed(4)} | 0 dict entries`);
    }

    // Show what the AI would see (summary)
    if (resolvedLevel !== expectLevel) {
        console.log(`  ${C.red}⚠️  Level mismatch! Got ${resolvedLevel}, expected ${expectLevel}${C.reset}`);
    } else {
        console.log(`  ${C.green}✓ Level matches expectation${C.reset}`);
    }

    return { level: resolvedLevel, dictEntries, maxScore };
}

async function main() {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.cyan}║   Te Tuvalu GPT — Deep Translation Pipeline Test     ║${C.reset}`);
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}\n`);

    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected');

    const phraseData = await PhrasePair.find({}).lean();
    console.log(`📚 Loaded ${phraseData.length} phrase pairs into fuzzy index`);

    const dictCount = await DictionaryEntry.countDocuments();
    console.log(`📖 Dictionary entries in DB: ${dictCount}`);

    const TEST_CASES = [
        // ── Level 1: Should be exact phrase match ──────────────────────────
        {
            description: 'Common phrase — expect exact match',
            input:       'I would like to check out tomorrow morning.',
            direction:   'en_to_tv',
            expectLevel: 1,
        },
        {
            description: 'Tuvaluan phrase — expect exact match',
            input:       'Au manako o asi kiei ite tafataeo ma taeao',
            direction:   'tv_to_en',
            expectLevel: 1,
        },

        // ── Level 1.5: Should be fuzzy match (slight variation) ────────────
        {
            description: 'Near-exact phrase with minor spelling variation',
            input:       'I would like to checkk out tomorrow morning.',   // slight typo
            direction:   'en_to_tv',
            expectLevel: 1.5,
        },

        // ── Level 2: Should hit chapter RAG (long cultural content) ────────
        {
            description: 'Cultural governance term — expect RAG chapter hit',
            input:       'The Kaupule is the governing council of Nanumea',
            direction:   'en_to_tv',
            expectLevel: 2,
        },
        {
            description: 'Long cultural Tuvaluan passage — expect RAG hit',
            input:       'Ko te Kaupule te fono o te fenua o Nanumea',
            direction:   'tv_to_en',
            expectLevel: 2,
        },

        // ── Level 2.5: Should use dictionary (no phrase or RAG match) ──────
        {
            description: 'Father in law — compound phrase, dict only',
            input:       'This is my father in law',
            direction:   'en_to_tv',
            expectLevel: 2.5,
        },
        {
            description: 'Reverse: father in law in Tuvaluan back to English',
            input:       'Te tamana o toku avaga',
            direction:   'tv_to_en',
            expectLevel: 2.5,
        },
        {
            description: 'Spouse word — expect dictionary replacement',
            input:       'This is the father of my spouse',
            direction:   'en_to_tv',
            expectLevel: 2.5,
        },
        {
            description: 'School/education term — dict lookup',
            input:       'The teacher went to school',
            direction:   'en_to_tv',
            expectLevel: 2.5,
        },
        {
            description: 'Body part — dictionary word test',
            input:       'My head is hurting',
            direction:   'en_to_tv',
            expectLevel: 2.5,
        },
        {
            description: 'Animal word — dict test',
            input:       'I saw a dog and a cat',
            direction:   'en_to_tv',
            expectLevel: 2.5,
        },

        // ── Level 3: Obscure modern term — no match anywhere ───────────────
        {
            description: 'Modern tech term — expect pure LLM fallback',
            input:       'Please download the software application',
            direction:   'en_to_tv',
            expectLevel: 3,
        },
    ];

    const results = [];
    for (let i = 0; i < TEST_CASES.length; i++) {
        const r = await runTest(TEST_CASES[i], phraseData, i);
        results.push({ ...TEST_CASES[i], ...r });
        // Small delay to avoid OpenAI rate limits
        if (i < TEST_CASES.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.cyan}║                  TEST SUMMARY                        ║${C.reset}`);
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);

    const levelCount = { 1: 0, 1.5: 0, 2: 0, 2.5: 0, 3: 0 };
    results.forEach(r => {
        const match = r.level === r.expectLevel;
        const icon  = match ? `${C.green}✅` : `${C.red}❌`;
        console.log(`  ${icon} Test: "${r.description.slice(0,45).padEnd(45)}" → Level ${r.level} (expected ${r.expectLevel})${C.reset}`);
        if (levelCount[r.level] !== undefined) levelCount[r.level]++;
    });

    console.log(`\n${C.bold}Level distribution:${C.reset}`);
    Object.entries(levelCount).forEach(([lvl, cnt]) => {
        if (cnt > 0) console.log(`  Level ${lvl}: ${cnt} test(s)`);
    });

    await mongoose.disconnect();
    console.log(`\n${C.green}✅ Test complete.${C.reset}\n`);
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
