/**
 * Te Tuvalu RAG — Chapter PDF Ingestion Script (v2)
 *
 * Architecture:
 *  1. Explicit EN↔TV chapter pairing via CHAPTER_PAIRS map (no filename guessing)
 *  2. Paragraph-level chunking (40–200 words) for precise semantic retrieval
 *  3. Bilingual pair chunks: each EN paragraph is stored alongside its proportionally
 *     aligned TV paragraph in a single 'bilingual' chunk — so queries in EITHER
 *     language retrieve the complete translation pair with high cosine similarity
 *  4. After ingestion, exact pairedChunkId links are written between EN↔TV paragraphs
 *
 * Usage:
 *   node scripts/ingestData.js           # incremental — skip already-ingested chapters
 *   node scripts/ingestData.js --wipe    # drop collection and re-ingest everything
 *   node scripts/ingestData.js --dry-run # parse + chunk but don't write to DB
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import DocumentChunk from '../models/DocumentChunk.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR       = path.resolve(__dirname, '../datasets/raw-pdfs');
const EMBED_MODEL   = 'text-embedding-3-small';
const EMBED_BATCH   = 20;
const MIN_WORDS     = 40;   // merge paragraphs shorter than this
const MAX_WORDS     = 200;  // split paragraphs longer than this
const OVERLAP_WORDS = 30;   // word overlap when splitting oversized paragraphs

// ── OpenAI client ─────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// EXPLICIT CHAPTER PAIRING MAP
// Every English PDF is explicitly linked to its Tuvaluan counterpart.
// Chapter 13 is excluded (no verified English version available).
// ─────────────────────────────────────────────────────────────────────────────
const CHAPTER_PAIRS = [
    {
        chapterId:    'Chapter 1',
        chapterTitle: 'Te Fenua ko Nanumea',
        en: 'Chapter 1 English Lang - Te Fenua ko Nanumea.pdf',
        tv: 'Chapter 1 Tuvalu Lang - Te Fenua ko Nanumea.pdf',
    },
    {
        chapterId:    'Chapter 2',
        chapterTitle: 'Fakavae akenga o faigaiga aliki o Nanumea',
        en: 'Chapter 2 English Lang - Fakavae akenga o faigaiga aliki o Nanumea.pdf',
        tv: 'Chapter 2 Tuvalu lang - Fakavae akenga o faifaiga aliki o Nanumea.pdf',
    },
    {
        chapterId:    'Chapter 3',
        chapterTitle: 'Te loto o te Fenua',
        en: 'Chapter 3 English Lang - te loto o te fenua.pdf',
        tv: 'Chapter 3 Tuvalu Lang - Te loto o te Fenua.pdf',
    },
    {
        chapterId:    'Chapter 4',
        chapterTitle: 'Pulepulega o te Fenua',
        en: 'Chapter 4 English Lang - pulepulega o te fenua.pdf',
        tv: 'Chapter 4 Tuvalu Lang - Pulepulega o te feanua.pdf',
    },
    {
        chapterId:    'Chapter 5',
        chapterTitle: 'Mataupu 5',
        en: 'Chapter 5 English lang- Mataupu 5.pdf',
        tv: 'Chapter 5 Tuvalu Lang - Mataupu 5.pdf',
    },
    {
        chapterId:    'Chapter 6',
        chapterTitle: 'Mataupu 6',
        en: 'Chapter 6 English Lang - Mataupu 6.pdf',
        tv: 'Chapter 6 Tuvalu Lang - Mataupu 6.pdf',
    },
    {
        chapterId:    'Chapter 7',
        chapterTitle: 'Mataupu 7',
        en: 'Chapter 7 English Lang - Mataupu 7.pdf',
        tv: 'Chapter 7 Tuvalu lang - Mataupu 7.pdf',
    },
    {
        chapterId:    'Chapter 8',
        chapterTitle: 'Mataupu 8',
        en: 'Chapter 8 English lang - Mataupu 8.pdf',
        tv: 'Chapter 8 Tuvalu Lang- Mataupu 8.pdf',
    },
    {
        chapterId:    'Chapter 9',
        chapterTitle: 'Mataupu 9',
        en: 'Chapter 9, English lang - Mataupu 9.pdf',
        tv: 'Chapter 9, Tuvalu lang - Mataupu 9.pdf',
    },
    {
        chapterId:    'Chapter 10',
        chapterTitle: 'Ika mo te Faiva / Fish and Fishing',
        en: 'Chapter 10, English Lang Mataupu 10.pdf',
        tv: 'Chapter 10, Tuvalu Lang - Mataupu 10.pdf',
    },
    {
        chapterId:    'Chapter 11',
        chapterTitle: 'Mataupu 11',
        en: 'Chapter 11 English language - Mataupu 11.pdf',
        tv: 'Chapter 11 Tuvalu lang - Mataupu 11.pdf',
    },
    {
        chapterId:    'Chapter 12',
        chapterTitle: 'Mataupu 12',
        en: 'Chapter 12 English lang - Mataupu 12.pdf',
        tv: 'Chapter 12 Tuvalu lang - Mataupu 12.pdf',
    },
    // Chapter 13 excluded — no verified English version
    {
        chapterId:    'Chapter 14',
        chapterTitle: 'Mataupu 14',
        en: 'Chapter 14, English Lang - Mataupu 14.pdf',
        tv: 'Chapter 14 Tuvalu Lang - Mataupu 14.pdf',
    },
    {
        chapterId:    'Chapter 15',
        chapterTitle: 'Mataupu 15',
        en: 'Chapter 15, English Lang - Mataupu 15.pdf',
        tv: 'Chapter 15, Tuvalu Lang - Mataupu 15.pdf',
    },
    {
        chapterId:    'Chapter 16',
        chapterTitle: 'Mataupu 16',
        en: 'Chapter 16, English Lang - Mataupu 16.pdf',
        tv: 'Chapter 16 Tuvalu Lang - Mataupu 16.pdf',
    },
    {
        chapterId:    'Chapter 17',
        chapterTitle: 'Mataupu 17',
        en: 'Chapter 17 English lang - Mataupu 17.pdf',
        tv: 'Chapter 17 Tuvalu lang - Mataupu 17.pdf',
    },
];

// ── Supplementary bilingual phrase files (existing phrase-table PDFs) ─────────
const BILINGUAL_FILES = [
    'English_Tuvaluan_Practice.docx.pdf',
    'English_Tuvaluan_Set2.docx.pdf',
    'tuvalu_phrases_love and health.docx.pdf',
    'Tuvaluan_Family_Phrases.docx.pdf',
    'Tuvaluan_Singing_Music_Phrases.docx.pdf',
    'Tuvaluan_Sports_Phrases.docx.pdf',
    'tuvaluan_phrases.docx.pdf',
    'tuvaluan_phrases2.docx.pdf',
    'tuvaluan_phrases3.docx.pdf',
    'tuvaluan_phrases4.docx.pdf',
    'tuvaluan_phrases6.docx.pdf',
    'tuvaluan_phrases7.docx.pdf',
    'tuvaluan_phrases8.docx.pdf',
    'tuvaluan_phrases9.docx.pdf',
    'tuvaluan_phrases10.docx.pdf',
    'tuvaluan_phrases11.docx.pdf',
];

// ─────────────────────────────────────────────────────────────────────────────
// Paragraph-Level Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split PDF text into paragraphs.
 * Strategy:
 *  1. Split on blank lines (\n\n) — natural paragraph boundaries from pdf-parse
 *  2. Merge consecutive paragraphs that are too short (<MIN_WORDS)
 *  3. Split paragraphs that are too long (>MAX_WORDS) with OVERLAP_WORDS overlap
 */
function extractParagraphs(rawText) {
    // Normalise line endings and collapse 3+ blank lines to double blank
    const text = rawText
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Initial split on blank lines
    const rawParas = text.split(/\n\n+/).map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

    // Phase 1: Merge short paragraphs with the next one
    const merged = [];
    let buffer = '';
    for (const para of rawParas) {
        const combined = buffer ? `${buffer} ${para}` : para;
        const wordCount = combined.split(/\s+/).length;
        if (wordCount < MIN_WORDS) {
            buffer = combined; // keep accumulating
        } else {
            merged.push(combined);
            buffer = '';
        }
    }
    if (buffer) merged.push(buffer); // flush remaining

    // Phase 2: Split oversized paragraphs
    const final = [];
    for (const para of merged) {
        const words = para.split(/\s+/);
        if (words.length <= MAX_WORDS) {
            final.push(para);
            continue;
        }
        // Sliding window split
        let start = 0;
        while (start < words.length) {
            const end   = Math.min(start + MAX_WORDS, words.length);
            const chunk = words.slice(start, end).join(' ');
            if (chunk.split(/\s+/).length >= MIN_WORDS) {
                final.push(chunk);
            }
            if (end === words.length) break;
            start += MAX_WORDS - OVERLAP_WORDS;
        }
    }

    return final;
}

/**
 * Parse bilingual phrase-table PDF (number / English / Tuvaluan triplets).
 * Returns [{text:'English\nTuvaluan', language:'bilingual'}] or null.
 */
function parseBilingualTable(rawText) {
    const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
    const pairs = [];
    let i = 0;
    while (i < lines.length) {
        if (/^\d+$/.test(lines[i])) {
            const enPhrase = lines[i + 1];
            const tvPhrase = lines[i + 2];
            const isHeader = !enPhrase || !tvPhrase
                || /^(?:#|English|Tuvaluan|Please fill|Translation Table|contributing)/i.test(enPhrase);
            if (!isHeader && enPhrase.length > 1 && tvPhrase.length > 1) {
                pairs.push({ text: `${enPhrase.trim()}\n${tvPhrase.trim()}`, language: 'bilingual' });
            }
            i += 3;
        } else { i++; }
    }
    return pairs.length >= 5 ? pairs : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────────────────────────
async function embedBatch(texts) {
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch    = texts.slice(i, i + EMBED_BATCH);
        const response = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
        const sorted   = response.data.sort((a, b) => a.index - b.index);
        allEmbeddings.push(...sorted.map(e => e.embedding));
    }
    return allEmbeddings;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Processing
// ─────────────────────────────────────────────────────────────────────────────
async function parsePdf(filename) {
    const buffer = fs.readFileSync(path.join(PDF_DIR, filename));
    const result = await pdfParse(buffer);
    return result.text;
}

/**
 * Process one CHAPTER PAIR (English + Tuvaluan) and return all chunk docs:
 *  - EN paragraph chunks
 *  - TV paragraph chunks
 *  - Bilingual pair chunks (one per EN paragraph, containing its proportional TV match)
 */
async function processChapterPair(pair, dryRun = false) {
    const { chapterId, chapterTitle, en: enFile, tv: tvFile } = pair;
    const enDocId = `${chapterId.toLowerCase().replace(' ', '_')}_en`;
    const tvDocId = `${chapterId.toLowerCase().replace(' ', '_')}_tv`;

    // Parse PDFs
    let enText, tvText;
    try { enText = await parsePdf(enFile); } catch (e) { throw new Error(`Failed to parse EN PDF: ${e.message}`); }
    try { tvText = await parsePdf(tvFile); } catch (e) { throw new Error(`Failed to parse TV PDF: ${e.message}`); }

    // Extract paragraphs
    const enParas = extractParagraphs(enText);
    const tvParas = extractParagraphs(tvText);

    if (enParas.length === 0 || tvParas.length === 0) {
        throw new Error(`No paragraphs extracted: EN=${enParas.length} TV=${tvParas.length}`);
    }

    // Build bilingual pair texts using proportional alignment.
    // EN para at index i maps to TV para at index Math.round(i * tvParas.length / enParas.length)
    const bilingualTexts = enParas.map((enPara, i) => {
        const tvIdx  = Math.round(i * (tvParas.length - 1) / Math.max(enParas.length - 1, 1));
        const tvPara = tvParas[Math.min(tvIdx, tvParas.length - 1)];
        return `ENGLISH:\n${enPara}\n\nTUVALUAN:\n${tvPara}`;
    });

    if (dryRun) {
        console.log(`    [DRY RUN] ${chapterId}: EN=${enParas.length} TV=${tvParas.length} BilingualPairs=${bilingualTexts.length}`);
        return [];
    }

    // Embed all texts concurrently in 3 batches
    const [enEmbeddings, tvEmbeddings, biEmbeddings] = await Promise.all([
        embedBatch(enParas),
        embedBatch(tvParas),
        embedBatch(bilingualTexts),
    ]);

    const totalEnChunks = enParas.length;
    const totalTvChunks = tvParas.length;

    // Build chunk documents
    const enDocs = enParas.map((text, i) => ({
        text,
        embedding:        enEmbeddings[i],
        source:           enFile,
        language:         'en',
        chapterId,
        chapterTitle,
        documentId:       enDocId,
        pairedDocumentId: tvDocId,
        chunkIndex:       i,
        totalChunks:      totalEnChunks,
        pairedChunkId:    null, // set after TV docs are inserted
    }));

    const tvDocs = tvParas.map((text, i) => ({
        text,
        embedding:        tvEmbeddings[i],
        source:           tvFile,
        language:         'tv',
        chapterId,
        chapterTitle,
        documentId:       tvDocId,
        pairedDocumentId: enDocId,
        chunkIndex:       i,
        totalChunks:      totalTvChunks,
        pairedChunkId:    null, // set after EN docs are inserted
    }));

    const biDocs = bilingualTexts.map((text, i) => ({
        text,
        embedding:        biEmbeddings[i],
        source:           `${chapterId} [bilingual pair]`,
        language:         'bilingual',
        chapterId,
        chapterTitle,
        documentId:       `${chapterId.toLowerCase().replace(' ', '_')}_bilingual`,
        pairedDocumentId: enDocId,
        chunkIndex:       i,
        totalChunks:      bilingualTexts.length,
        pairedChunkId:    null,
    }));

    return { enDocs, tvDocs, biDocs };
}

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB Upsert
// ─────────────────────────────────────────────────────────────────────────────
async function upsertChunks(docs) {
    if (!docs || docs.length === 0) return 0;
    const ops = docs.map(doc => ({
        updateOne: {
            filter: { source: doc.source, chunkIndex: doc.chunkIndex },
            update: { $set: doc },
            upsert: true,
        },
    }));
    const result = await DocumentChunk.bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
}

/**
 * After all EN and TV chunks are saved, link pairedChunkId between them.
 * EN[i] ← proportional mapping → TV[j], same formula used for bilingual pairs.
 */
async function linkPairedChunks(chapterId, enDocId, tvDocId) {
    const enChunks = await DocumentChunk
        .find({ documentId: enDocId })
        .sort({ chunkIndex: 1 })
        .select('_id chunkIndex')
        .lean();
    const tvChunks = await DocumentChunk
        .find({ documentId: tvDocId })
        .sort({ chunkIndex: 1 })
        .select('_id chunkIndex')
        .lean();

    if (!enChunks.length || !tvChunks.length) return 0;

    const ops = [];
    for (let i = 0; i < enChunks.length; i++) {
        const tvIdx  = Math.round(i * (tvChunks.length - 1) / Math.max(enChunks.length - 1, 1));
        const tvChunk = tvChunks[Math.min(tvIdx, tvChunks.length - 1)];
        ops.push(
            { updateOne: { filter: { _id: enChunks[i]._id }, update: { $set: { pairedChunkId: tvChunk._id } } } },
            { updateOne: { filter: { _id: tvChunk._id },    update: { $set: { pairedChunkId: enChunks[i]._id } } } }
        );
    }
    await DocumentChunk.bulkWrite(ops, { ordered: false });
    return enChunks.length;
}

/**
 * Process bilingual phrase-table PDFs.
 */
async function processBilingualFiles(dryRun = false) {
    let total = 0;
    for (const filename of BILINGUAL_FILES) {
        const filepath = path.join(PDF_DIR, filename);
        if (!fs.existsSync(filepath)) {
            console.warn(`  ⚠  Bilingual file not found, skipping: ${filename}`);
            continue;
        }
        process.stdout.write(`  ⏳ Processing bilingual: ${filename}…`);
        try {
            const rawText = await parsePdf(filename);
            const pairs   = parseBilingualTable(rawText);
            if (!pairs || pairs.length === 0) {
                console.log(' ⚠ No phrase pairs found');
                continue;
            }
            if (dryRun) {
                console.log(` [DRY RUN] ${pairs.length} pairs`);
                continue;
            }
            const embeddings = await embedBatch(pairs.map(p => p.text));
            const docs = pairs.map((p, i) => ({
                text:             p.text,
                embedding:        embeddings[i],
                source:           filename,
                language:         'bilingual',
                chapterId:        null,
                chapterTitle:     null,
                documentId:       `bilingual_${filename.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
                pairedDocumentId: null,
                chunkIndex:       i,
                totalChunks:      pairs.length,
                pairedChunkId:    null,
            }));
            const saved = await upsertChunks(docs);
            console.log(` ✓ ${pairs.length} pairs (${saved} saved)`);
            total += pairs.length;
        } catch (err) {
            console.log(` ✗ ERROR: ${err.message}`);
        }
    }
    return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    const wipe   = process.argv.includes('--wipe');
    const dryRun = process.argv.includes('--dry-run');

    console.log('🚀 Te Tuvalu RAG — Chapter Ingestion (v2 — Paragraph-Level Bilingual Pairing)');
    console.log('=============================================================================\n');

    if (dryRun) console.log('⚠️  DRY RUN MODE — no data will be written\n');

    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    console.log('✅ MongoDB connected\n');

    if (wipe && !dryRun) {
        console.log('🗑️  --wipe flag detected — dropping document_chunks collection…');
        await mongoose.connection.db.collection('documentchunks').drop().catch(() => {});
        console.log('   ↳ Collection dropped\n');
    }

    await DocumentChunk.ensureIndexes();

    // Verify all PDF files exist before starting
    console.log('🔍 Verifying PDF files exist…');
    let allFound = true;
    for (const pair of CHAPTER_PAIRS) {
        const enPath = path.join(PDF_DIR, pair.en);
        const tvPath = path.join(PDF_DIR, pair.tv);
        if (!fs.existsSync(enPath)) { console.error(`   ✗ MISSING EN: ${pair.en}`); allFound = false; }
        if (!fs.existsSync(tvPath)) { console.error(`   ✗ MISSING TV: ${pair.tv}`); allFound = false; }
    }
    if (!allFound) { console.error('\n❌ Missing PDF files. Aborting.'); await mongoose.disconnect(); process.exit(1); }
    console.log(`   ✓ All ${CHAPTER_PAIRS.length * 2} chapter PDFs verified\n`);

    // Determine which chapters need processing
    const existingSources = wipe ? new Set() : new Set(await DocumentChunk.distinct('source'));
    const toProcess = wipe
        ? CHAPTER_PAIRS
        : CHAPTER_PAIRS.filter(p => !existingSources.has(p.en));

    if (toProcess.length === 0) {
        console.log('✅ All chapters already ingested. Skipping chapter processing.\n');
    }

    // Stats
    const stats = {
        chapters: 0,
        enChunks: 0,
        tvChunks: 0,
        bilingualPairs: 0,
        errors: [],
    };

    // Process each chapter pair sequentially (avoids rate-limit bursts)
    for (const pair of toProcess) {
        process.stdout.write(`\n📖 Processing ${pair.chapterId}: "${pair.chapterTitle}"…\n`);
        try {
            const result = await processChapterPair(pair, dryRun);

            if (dryRun || !result) continue;

            const { enDocs, tvDocs, biDocs } = result;

            // Upsert in order: EN → TV → bilingual
            const enSaved = await upsertChunks(enDocs);
            const tvSaved = await upsertChunks(tvDocs);
            const biSaved = await upsertChunks(biDocs);

            // Link pairedChunkId
            const enDocId = `${pair.chapterId.toLowerCase().replace(' ', '_')}_en`;
            const tvDocId = `${pair.chapterId.toLowerCase().replace(' ', '_')}_tv`;
            const linked  = await linkPairedChunks(pair.chapterId, enDocId, tvDocId);

            console.log(`   ✓ EN: ${enDocs.length} paragraphs (${enSaved} saved)`);
            console.log(`   ✓ TV: ${tvDocs.length} paragraphs (${tvSaved} saved)`);
            console.log(`   ✓ Bilingual pairs: ${biDocs.length} (${biSaved} saved)`);
            console.log(`   ✓ Cross-linked: ${linked} EN↔TV pairs`);

            stats.chapters++;
            stats.enChunks      += enDocs.length;
            stats.tvChunks      += tvDocs.length;
            stats.bilingualPairs += biDocs.length;
        } catch (err) {
            console.log(`   ✗ ERROR processing ${pair.chapterId}: ${err.message}`);
            stats.errors.push({ chapter: pair.chapterId, error: err.message });
        }
    }

    // Process bilingual phrase files
    console.log('\n📝 Processing bilingual phrase tables…');
    const phraseTotal = await processBilingualFiles(dryRun);

    // Final summary
    console.log('\n═══════════════════════════════════════════');
    console.log('📊 INGESTION SUMMARY');
    console.log('═══════════════════════════════════════════');
    console.log(`  Chapters processed     : ${stats.chapters} / ${CHAPTER_PAIRS.length}`);
    console.log(`  English chunks         : ${stats.enChunks}`);
    console.log(`  Tuvaluan chunks        : ${stats.tvChunks}`);
    console.log(`  Bilingual pair chunks  : ${stats.bilingualPairs}`);
    console.log(`  Phrase table entries   : ${phraseTotal}`);
    console.log(`  Total chunks           : ${stats.enChunks + stats.tvChunks + stats.bilingualPairs + phraseTotal}`);
    if (stats.errors.length > 0) {
        console.log(`\n  ⚠ Errors (${stats.errors.length}):`);
        stats.errors.forEach(e => console.log(`    - ${e.chapter}: ${e.error}`));
    } else {
        console.log('\n  ✅ No errors');
    }
    console.log('═══════════════════════════════════════════\n');

    if (!dryRun) {
        console.log('📌 Next step: Run node scripts/ingestBible.js to ingest the Tuvaluan Bible.\n');
        console.log('📌 Atlas Vector Search index reminder:');
        console.log('   Collection : document_chunks');
        console.log('   Index name : vector_index');
        console.log('   Field      : embedding (vector, cosine, 1536 dims)\n');
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
