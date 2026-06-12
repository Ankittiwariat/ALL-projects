/**
 * Ingest Tuvaluan Dictionary PDF — v2 (Direct Line Parse)
 *
 * Source: newDataset/tuvaluan-dictionary-formatted.pdf
 * Format: "english_word [optional_pos]  tuvaluan_translation"  (2+ spaces separator)
 * 10,399 entries compiled by Kelly Roy.
 *
 * This approach:
 *  - Zero GPT calls (pure regex parsing — 100x cheaper, 100x faster)
 *  - Embeds all entries with text-embedding-3-small in batches of 100
 *  - Saves to 'dictionaryentries' collection
 *
 * Usage:
 *   node scripts/ingestDictionary.js          # ingest
 *   node scripts/ingestDictionary.js --wipe   # wipe + re-ingest
 *   node scripts/ingestDictionary.js --report # count only
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import DictionaryEntry from '../models/DictionaryEntry.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH    = path.resolve(__dirname, '../newDataset/tuvaluan-dictionary-formatted.pdf');
const SOURCE      = 'tuvaluan-dictionary-formatted.pdf';
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_BATCH = 100;
const INSERT_BATCH = 500;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Known POS labels to extract from the English side
const POS_LABELS = new Set([
    'verb','noun','adj','adjective','adv','adverb',
    'phrase','prep','preposition','conj','conjunction',
    'pron','pronoun','intj','interjection','article',
    'num','numeral','abbr','abbreviation','prefix','suffix',
    'idiom','excl','exclamation','n','v'
]);

// Lines to skip (page headers, single guide letters, intro text, etc.)
const SKIP_PATTERNS = [
    /^$/,
    /^\d+$/,                                // standalone page numbers
    /^[A-Z]$/,                             // single guide letters A, B, C...
    /^Tuvaluan Dictionary/i,
    /^English\s*[–\-]\s*Tuvaluan/i,
    /^How to use/i,
    /^This dictionary/i,
    /^alphabetically/i,
    /^Example$/i,
    /^Guide words/i,
    /^Numbers \/ Symbols/i,
    /^Compiled by/i,
    /^A vocabulary/i,
    /^\d+[A-Z][a-z]/,                      // e.g. "3Tuvaluan..." merged header
    /^[A-Z]{1,3}\d/,                       // guide word artifacts
    /^quickly\./i,
    /^one Tuvaluan/i,
];

function isNoise(line) {
    const t = line.trim();
    return SKIP_PATTERNS.some(p => p.test(t));
}

/**
 * Parse one dictionary line.
 * Returns { english, tuvaluan, partOfSpeech } or null.
 */
function parseLine(rawLine) {
    const line = rawLine.trim();
    if (!line || isNoise(line)) return null;

    // Must contain 2+ spaces separating English side from Tuvaluan
    const match = line.match(/^(.+?)\s{2,}(.+)$/);
    if (!match) return null;

    let englishSide = match[1].trim();
    const tuvaluan  = match[2].trim();

    if (!englishSide || !tuvaluan) return null;
    // Filter clearly bad parses
    if (englishSide.length > 150 || tuvaluan.length > 250) return null;
    if (/^&\w+;/.test(tuvaluan)) return null; // HTML entities

    // Extract optional POS from end of English side
    let partOfSpeech = null;
    const tokens = englishSide.split(/\s+/);
    const lastToken = tokens[tokens.length - 1].toLowerCase().replace(/\.$/, '');
    if (tokens.length > 1 && POS_LABELS.has(lastToken)) {
        partOfSpeech = lastToken;
        englishSide  = tokens.slice(0, -1).join(' ').trim();
    }

    return { english: englishSide, tuvaluan, partOfSpeech };
}

function buildEntryText(entry) {
    let t = `English: ${entry.english} → Tuvaluan: ${entry.tuvaluan}`;
    if (entry.partOfSpeech) t += ` (${entry.partOfSpeech})`;
    return t;
}

async function embedBatch(texts) {
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map(e => e.embedding);
}

async function main() {
    const wipe       = process.argv.includes('--wipe');
    const reportOnly = process.argv.includes('--report');

    console.log('📚 Tuvaluan Dictionary Ingestion v2 (Direct Parse)\n');
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected');

    if (reportOnly) {
        const total = await DictionaryEntry.countDocuments();
        const fromThisSource = await DictionaryEntry.countDocuments({ source: SOURCE });
        console.log(`\n📊 Total dictionary entries in DB : ${total}`);
        console.log(`   From ${SOURCE}: ${fromThisSource}`);
        await mongoose.disconnect();
        return;
    }

    if (!fs.existsSync(PDF_PATH)) {
        console.error('❌ Dictionary PDF not found at:', PDF_PATH);
        process.exit(1);
    }

    // Check if already ingested
    if (!wipe) {
        const existing = await DictionaryEntry.countDocuments({ source: SOURCE });
        if (existing > 0) {
            console.log(`ℹ️  Already ingested ${existing} entries from ${SOURCE}.`);
            console.log(`   Use --wipe to re-ingest.\n`);
            await mongoose.disconnect();
            return;
        }
    }

    // Wipe existing from this source
    if (wipe) {
        const del = await DictionaryEntry.deleteMany({ source: SOURCE });
        console.log(`🗑️  Cleared ${del.deletedCount} existing entries\n`);
    }

    // Parse PDF
    process.stdout.write('📄 Parsing PDF...');
    const buf    = fs.readFileSync(PDF_PATH);
    const parsed = await pdfParse(buf);
    const lines  = parsed.text.split('\n');
    console.log(` ${parsed.numpages} pages, ${lines.length} lines`);

    // Extract entries line by line
    const entries = [];
    const seen    = new Set();

    for (const line of lines) {
        const entry = parseLine(line);
        if (!entry) continue;

        // Deduplicate by english+tuvaluan
        const key = `${entry.english.toLowerCase()}::${entry.tuvaluan.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
    }

    console.log(`✅ Parsed ${entries.length} unique entries\n`);

    if (entries.length === 0) {
        console.error('❌ No entries parsed — check PDF format');
        process.exit(1);
    }

    // Build entry texts for embedding
    const entryTexts = entries.map(buildEntryText);

    // Embed in batches of 100
    console.log(`🔢 Embedding ${entries.length} entries (batch size ${EMBED_BATCH})...`);
    const allEmbeddings = [];
    for (let i = 0; i < entryTexts.length; i += EMBED_BATCH) {
        const batch  = entryTexts.slice(i, i + EMBED_BATCH);
        const embeds = await embedBatch(batch);
        allEmbeddings.push(...embeds);
        if ((i + EMBED_BATCH) % 1000 < EMBED_BATCH || i + EMBED_BATCH >= entryTexts.length) {
            process.stdout.write(`\r   Embedded: ${Math.min(i + EMBED_BATCH, entries.length)}/${entries.length}  `);
        }
    }
    console.log('\n');

    // Build MongoDB documents
    const docs = entries.map((entry, idx) => ({
        headword:     entry.english,
        language:     'en',
        definition:   entry.tuvaluan,
        partOfSpeech: entry.partOfSpeech || null,
        examples:     null,
        entryText:    entryTexts[idx],
        embedding:    allEmbeddings[idx],
        chunkIndex:   idx,
        source:       SOURCE,
    }));

    // Insert in batches
    console.log(`💾 Saving ${docs.length} entries...`);
    let saved = 0;
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
        const batch = docs.slice(i, i + INSERT_BATCH);
        await DictionaryEntry.insertMany(batch, { ordered: false });
        saved += batch.length;
        process.stdout.write(`\r   Saved: ${saved}/${docs.length}  `);
    }
    console.log('\n');

    console.log(`✅ Done! ${saved} dictionary entries saved to 'dictionaryentries'\n`);
    console.log(`⚠️  NEXT STEP — Create Atlas vector index on 'dictionaryentries':`);
    console.log(`   Index name : dictionary_vector_index`);
    console.log(`   Field      : embedding (vector, cosine, 1536 dims)\n`);

    await mongoose.disconnect();
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
