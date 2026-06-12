/**
 * Ingest Bilingual PDFs from newDataset/ — v3 FINAL
 *
 * PDF Structure (from screenshots): True 2-column page layout.
 * LEFT column = Tuvaluan, RIGHT column = English.
 * pdf-parse reads left column lines first, then right column (sometimes mixed).
 *
 * KEY INSIGHT from debug output:
 * The PDF has section headings that appear BEFORE paragraphs:
 *   [TV heading] (1 line, short)
 *   [blank]
 *   [EN heading] (1 line, short)
 *   [TV paragraph block] (many lines)
 *   [EN paragraph block] (many lines)
 *
 * Strategy v3:
 *  - Line-by-line language classification using TV signatures
 *  - Eagerly split into TV/EN blocks on language transitions
 *  - Pair each TV block immediately with the next EN block
 *  - Each paired section = one chunk (NO merging into 300-word mega chunks)
 *  - This preserves exact phrase-level alignment for RAG retrieval
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import DocumentChunk from '../models/DocumentChunk.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR     = path.resolve(__dirname, '../newDataset');
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_BATCH = 20;
const MIN_WORDS   = 4;  // minimum words for a block to be valid
const MAX_CHUNK_WORDS = 200; // max words per bilingual chunk

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Tuvaluan language signatures ──────────────────────────────────────────────
// Words that are EXCLUSIVELY or predominantly Tuvaluan
const TV_EXCLUSIVE = new Set([
    'fenua','fale','ika','matagi','kāiga','kaiga','lātou','latou',
    'ailoa','fakatahi','mafai','tatou','laukele','faifaiga','mālō','malo',
    'tulāfono','tulafono','kautama','fakamatala','kaupule','falekaupule',
    'tamaliki','pulefenua','aliki','tamana','tinana','galue','fano','nofo',
    'hoki','pelā','pela','kolā','kola','konei','tenei','tena','tenā',
    'tāua','taua','olaga','uiga','faipoipo','āvaga','avaga','fekau',
    'faifaiga','mātua','tino','tagata','koe','oi','tala','mua',
    'fakamataku','fakafanoanoa','fakatokatokaga','mahina','tauhaga',
    'fakaogaga','pūlega','pulepulega','fehokotakiga','senetenali',
    'fakaaogā','fakaaogaga','faimā\'laga','faifaiga','fakamāhani',
    'fakamātuatua','fakaimoa','fakataunugina','fakalavelave','heiloga',
    'manakoga','malalaga','folau','vaka','moana','pasefika',
    'ko','koa','mo','te','ai','atu','mai','ifo','ni','me','ia','a',
    'ka','ki','i','o','e','lā','la'
]);

function tvScore(text) {
    const tokens = text.toLowerCase()
        .replace(/[^a-zāēīōū\s']/gi, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
    if (tokens.length === 0) return 0;
    const hits = tokens.filter(t => TV_EXCLUSIVE.has(t)).length;
    return hits / tokens.length;
}

function detectLineLang(line) {
    const t = line.trim();
    if (!t || t.length < 3) return 'blank';

    // Skip bilingual title headers (contain | or /)
    if (/\s[|/]\s/.test(t)) return 'skip';

    // Skip footnote lines, page numbers
    if (/^[\d\s]+$/.test(t)) return 'skip';
    if (/^Te Tuvalu GPT|^Page \d/i.test(t)) return 'skip';

    const wordCount = t.split(/\s+/).length;
    if (wordCount < 2) return 'skip';

    const score = tvScore(t);

    // Tuvaluan: score >= 12% TV words
    // English: mostly standard English vocabulary
    if (score >= 0.12) return 'tv';
    return 'en';
}

/**
 * Group consecutive same-language lines into blocks.
 * Returns [{text, lang}]
 */
function getLanguageBlocks(rawText) {
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let currentLang = null;
    let currentLines = [];

    const flushBlock = () => {
        if (currentLines.length === 0) return;
        const text = currentLines.join(' ').replace(/\s+/g, ' ').trim();
        if (text.split(/\s+/).length >= MIN_WORDS) {
            blocks.push({ text, lang: currentLang });
        }
        currentLines = [];
    };

    for (const line of lines) {
        const lang = detectLineLang(line);

        if (lang === 'blank' || lang === 'skip') {
            // Blank line is always a paragraph separator — flush current block
            if (lang === 'blank' && currentLines.length > 0) {
                flushBlock();
                currentLang = null;
            }
            continue;
        }

        if (lang !== currentLang) {
            flushBlock();
            currentLang = lang;
        }

        currentLines.push(line.trim());
    }
    flushBlock();

    return blocks;
}

/**
 * Pair TV→EN blocks sequentially.
 * Each TV block paired with the very next EN block = one bilingual pair.
 * This preserves fine-grained alignment.
 */
function buildPairs(blocks) {
    const pairs = [];
    let pendingTv = null;

    for (const block of blocks) {
        if (block.lang === 'tv') {
            // If there's already a TV block pending without a match, keep accumulating TV
            if (pendingTv) {
                pendingTv = pendingTv + ' ' + block.text;
            } else {
                pendingTv = block.text;
            }
        } else if (block.lang === 'en') {
            if (pendingTv) {
                // Pair it
                pairs.push({ tv: pendingTv, en: block.text });
                pendingTv = null;
            }
            // EN block without a pending TV: skip (might be intro text)
        }
    }

    return pairs;
}

/**
 * Group pairs into chunks no larger than MAX_CHUNK_WORDS.
 * Each section heading + its body = one chunk where possible.
 */
function chunkPairs(pairs) {
    const chunks = [];
    let tvBuf = '';
    let enBuf = '';

    const flush = () => {
        if (tvBuf.trim() && enBuf.trim()) {
            chunks.push({ tv: tvBuf.trim(), en: enBuf.trim() });
        }
        tvBuf = '';
        enBuf = '';
    };

    for (const pair of pairs) {
        const projectedTv = (tvBuf + ' ' + pair.tv).trim();
        const projectedEn = (enBuf + ' ' + pair.en).trim();
        const tvWords = projectedTv.split(/\s+/).length;
        const enWords = projectedEn.split(/\s+/).length;

        if ((tvWords > MAX_CHUNK_WORDS || enWords > MAX_CHUNK_WORDS) && tvBuf) {
            flush();
        }

        tvBuf = (tvBuf + ' ' + pair.tv).trim();
        enBuf = (enBuf + ' ' + pair.en).trim();
    }

    flush();
    return chunks;
}

async function embedBatch(texts) {
    const all = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        const res = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
        all.push(...res.data.sort((a, b) => a.index - b.index).map(e => e.embedding));
    }
    return all;
}

async function processPdf(filename) {
    const buf    = fs.readFileSync(path.join(PDF_DIR, filename));
    const parsed = await pdfParse(buf);
    const blocks = getLanguageBlocks(parsed.text);
    const pairs  = buildPairs(blocks);

    if (pairs.length === 0) {
        const tvBlocks = blocks.filter(b => b.lang === 'tv').length;
        const enBlocks = blocks.filter(b => b.lang === 'en').length;
        throw new Error(`No pairs (TV blocks: ${tvBlocks}, EN blocks: ${enBlocks}, total: ${blocks.length})`);
    }

    const chunks = chunkPairs(pairs);
    // Embed both TV and EN together so queries in either language retrieve the chunk
    const texts  = chunks.map(c => `Tuvaluan: ${c.tv}\nEnglish: ${c.en}`);
    const embeds = await embedBatch(texts);

    const chapterMatch = filename.match(/Chapter_?(\d+)/i);
    const chapterId    = chapterMatch ? `Chapter ${chapterMatch[1]}` : 'Unknown';

    return chunks.map((chunk, idx) => ({
        text:        texts[idx],
        embedding:   embeds[idx],
        source:      filename,
        language:    'bilingual',
        chapterId,
        chapterTitle: null,
        documentId:  `${filename}_bilingual`,
        chunkIndex:  idx,
        totalChunks: chunks.length,
    }));
}

async function main() {
    console.log('🚀 Te Tuvalu RAG — Bilingual PDF Ingestion v3\n');
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected');

    const files = fs.readdirSync(PDF_DIR)
        .filter(f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('.') && !f.startsWith('~'))
        .sort();

    if (files.length === 0) {
        console.log('❌ No PDF files found in newDataset/');
        process.exit(1);
    }

    console.log(`📂 Found ${files.length} PDF files\n`);

    // Clear all existing bilingual chunks
    const del = await DocumentChunk.deleteMany({ language: 'bilingual' });
    if (del.deletedCount > 0) {
        console.log(`🗑️  Cleared ${del.deletedCount} old bilingual chunks\n`);
    }

    let totalSaved = 0;
    let totalPairs = 0;

    for (const file of files) {
        process.stdout.write(`📖 ${file}... `);
        try {
            const docs = await processPdf(file);
            await DocumentChunk.insertMany(docs, { ordered: false });
            console.log(`✓ ${docs.length} chunks`);
            totalSaved += docs.length;
        } catch (err) {
            console.log(`✗ ${err.message}`);
        }
    }

    console.log(`\n✅ Done! Total bilingual chunks saved: ${totalSaved}`);
    await mongoose.disconnect();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
