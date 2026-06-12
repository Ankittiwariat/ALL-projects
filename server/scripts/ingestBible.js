/**
 * Te Tuvalu RAG — Tuvaluan Bible Ingestion Script (v2)
 *
 * Ingests the full Tuvaluan Bible (Tuvalu-All-Bible.pdf) into a SEPARATE
 * 'bible_chunks' MongoDB collection. Completely isolated from document_chunks.
 *
 * PDF Structure:
 *   - Book name standalone: "Kenese"
 *   - Chapter heading:  "Kenese 1" followed by section title
 *   - Verse lines:  "1\ntext\n2\ntext..." or "1 text\n2 text..."
 *   - Verse ranges: "6-7\n  text..."
 *
 * Strategy:
 *   1. Parse full PDF text
 *   2. Split into per-book sections using exact book headings from TOC
 *   3. Within each book, detect chapter headings ("BookName N")
 *   4. Within each chapter, collect verses by number
 *   5. Group VERSES_PER_CHUNK verses into one chunk for embedding
 *   6. Embed + upsert into bible_chunks
 *   7. Produce validation report
 *
 * Usage:
 *   node scripts/ingestBible.js          # incremental
 *   node scripts/ingestBible.js --wipe   # drop + re-ingest all
 *   node scripts/ingestBible.js --report # validation report only
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import BibleChunk from '../models/BibleChunk.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const __dirname        = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR          = path.resolve(__dirname, '../datasets/raw-pdfs');
const BIBLE_FILE       = 'Tuvalu-All-Bible.pdf';
const EMBED_MODEL      = 'text-embedding-3-small';
const EMBED_BATCH      = 20;
const VERSES_PER_CHUNK = 15;    // ~60-100 words per chunk

// ── OpenAI client ─────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Tuvaluan Bible Book Names — EXACT as they appear in the PDF TOC and headings
// ─────────────────────────────────────────────────────────────────────────────
const TUVALUAN_BOOKS = [
    // Old Testament (39 books)
    { name: 'Kenese',              number: 1  },
    { name: 'Esoto',               number: 2  },
    { name: 'Levitiko',            number: 3  },
    { name: 'Numela',              number: 4  },
    { name: 'Teutelonome',         number: 5  },
    { name: 'Iosua',               number: 6  },
    { name: 'Famasino',            number: 7  },
    { name: 'Luta',                number: 8  },
    { name: '1 Samuelu',           number: 9  },
    { name: '2 Samuelu',           number: 10 },
    { name: '1 Tupu',              number: 11 },
    { name: '2 Tupu',              number: 12 },
    { name: '1 Nofoaiga Tupu',     number: 13 },
    { name: '2 Nofoaiga Tupu',     number: 14 },
    { name: 'Esela',               number: 15 },
    { name: 'Neemia',              number: 16 },
    { name: 'Eseta',               number: 17 },
    { name: 'Iopu',                number: 18 },
    { name: 'Salamo',              number: 19 },
    { name: 'Faataoto',            number: 20 },
    { name: 'Failauga',            number: 21 },
    { name: 'Pese a Solomona',     number: 22 },
    { name: 'Isaia',               number: 23 },
    { name: 'Ielemia',             number: 24 },
    { name: 'Tagiga a Ielemia',    number: 25 },
    { name: 'Esekielu',            number: 26 },
    { name: 'Tanielu',             number: 27 },
    { name: 'Hosea',               number: 28 },
    { name: 'Ioelu',               number: 29 },
    { name: 'Amosa',               number: 30 },
    { name: 'Opetaia',             number: 31 },
    { name: 'Iona',                number: 32 },
    { name: 'Mika',                number: 33 },
    { name: 'Nahume',              number: 34 },
    { name: 'Hapakuko',            number: 35 },
    { name: 'Sefanaia',            number: 36 },
    { name: 'Hakai',               number: 37 },
    { name: 'Sakalia',             number: 38 },
    { name: 'Malaki',              number: 39 },
    // New Testament (27 books)
    { name: 'Mataio',              number: 40 },
    { name: 'Maleko',              number: 41 },
    { name: 'Luka',                number: 42 },
    { name: 'Ioane',               number: 43 },
    { name: 'Galuega',             number: 44 },
    { name: 'Loma',                number: 45 },
    { name: '1 Kolinito',          number: 46 },
    { name: '2 Kolinito',          number: 47 },
    { name: 'Kalatia',             number: 48 },
    { name: 'Efeso',               number: 49 },
    { name: 'Filipi',              number: 50 },
    { name: 'Kolose',              number: 51 },
    { name: '1 Tesalonia',         number: 52 },
    { name: '2 Tesalonia',         number: 53 },
    { name: '1 Timoteo',           number: 54 },
    { name: '2 Timoteo',           number: 55 },
    { name: 'Tito',                number: 56 },
    { name: 'Filemoni',            number: 57 },
    { name: 'Epelu',               number: 58 },
    { name: 'Iakopo',              number: 59 },
    { name: '1 Petelu',            number: 60 },
    { name: '2 Petelu',            number: 61 },
    { name: '1 Ioane',             number: 62 },
    { name: '2 Ioane',             number: 63 },
    { name: '3 Ioane',             number: 64 },
    { name: 'Iuta',                number: 65 },
    { name: 'Fakaasiga',           number: 66 },
];

// Sort by name length descending so longer names match first in regex
const BOOKS_BY_LENGTH = [...TUVALUAN_BOOKS].sort((a, b) => b.name.length - a.name.length);

// ─────────────────────────────────────────────────────────────────────────────
// Bible Text Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the full raw Bible text into:
 * [{ book, bookNumber, chapter, verses: [{ verseRange, text }] }]
 */
function parseBibleText(rawText) {
    const lines = rawText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(l => l.trim());

    const sections = [];
    let currentBook    = null;
    let currentBookNum = 0;
    let currentChapter = 0;
    let verseBuffer    = [];   // { verseRange: '1', text: '...' }
    let currentText    = '';

    const flushVerse = () => {
        if (currentText.trim() && verseBuffer.length > 0) {
            const last = verseBuffer[verseBuffer.length - 1];
            last.text = (last.text + ' ' + currentText).trim();
        }
        currentText = '';
    };

    const flushChapter = () => {
        flushVerse();
        if (currentBook && currentChapter > 0 && verseBuffer.length > 0) {
            sections.push({
                book:       currentBook,
                bookNumber: currentBookNum,
                chapter:    currentChapter,
                verses:     [...verseBuffer],
            });
        }
        verseBuffer = [];
        currentText = '';
    };

    // Verse number line: standalone "1" or "6-7" or "1 text"
    const VERSE_LINE_RE  = /^(\d+(?:-\d+)?)\s*$/;
    const VERSE_WITH_TEXT_RE = /^(\d+(?:-\d+)?)\s+(.+)$/;
    // Chapter heading: "Kenese 1" or "1 Samuelu 3"
    const makeChapterRe = (bookName) => new RegExp(`^${escapeRegex(bookName)}\\s+(\\d+)\\s*$`, 'i');
    // Page number / copyright lines to skip
    const SKIP_RE = /^(\d+\s*)?Te Tusi Tapu|©\s*Bible Society|Tuvalu - All Bible|^T u v a l u/i;
    // Section title lines (all caps or title-like — no leading number)
    const SECTION_TITLE_RE = /^Ko te Tala|^[A-ZĀĒĪŌŪ][a-zāēīōū].*[a-z]$/;

    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        if (SKIP_RE.test(line)) continue;

        // ── Check if this line is a chapter heading: "BookName N" ──────────
        let foundChapter = false;
        for (const book of BOOKS_BY_LENGTH) {
            const re = makeChapterRe(book.name);
            const m  = line.match(re);
            if (m) {
                flushChapter();
                currentBook    = book.name;
                currentBookNum = book.number;
                currentChapter = parseInt(m[1], 10);
                foundChapter   = true;
                break;
            }
        }
        if (foundChapter) continue;

        // ── Check if this is a standalone book name (e.g. "Kenese") ────────
        const bookMatch = BOOKS_BY_LENGTH.find(b => line.toLowerCase() === b.name.toLowerCase());
        if (bookMatch) {
            // Just a book heading — chapter follows on next lines
            flushChapter();
            currentBook    = bookMatch.name;
            currentBookNum = bookMatch.number;
            currentChapter = 0;
            continue;
        }

        // Not inside a chapter yet — skip
        if (!currentBook || currentChapter === 0) continue;

        // ── Verse line: "1" or "6-7" standalone ──────────────────────────
        if (VERSE_LINE_RE.test(line)) {
            flushVerse();
            verseBuffer.push({ verseRange: line, text: '' });
            continue;
        }

        // ── Verse line with inline text: "1 In the beginning..." ──────────
        const vtm = line.match(VERSE_WITH_TEXT_RE);
        if (vtm) {
            flushVerse();
            verseBuffer.push({ verseRange: vtm[1], text: vtm[2].trim() });
            continue;
        }

        // ── Continuation text ────────────────────────────────────────────
        if (verseBuffer.length > 0) {
            currentText += ' ' + line;
        }
    }
    flushChapter(); // flush last chapter

    return sections;
}

/**
 * Group verses into chunks of VERSES_PER_CHUNK.
 */
function chunkVerses(verses) {
    const chunks = [];
    for (let i = 0; i < verses.length; i += VERSES_PER_CHUNK) {
        const group = verses.slice(i, i + VERSES_PER_CHUNK);
        const text  = group.map(v => `${v.verseRange} ${v.text}`).join(' ').trim();
        if (text.split(/\s+/).length < 5) continue; // skip near-empty
        const startVerse = parseInt(group[0].verseRange.split('-')[0], 10);
        const endGroup   = group[group.length - 1].verseRange;
        const endVerse   = parseInt(endGroup.split('-').pop(), 10);
        chunks.push({
            text,
            verseRange:  `${startVerse}-${endVerse}`,
            verseStart:  startVerse,
            verseEnd:    endVerse,
            chunkIndex:  Math.floor(i / VERSES_PER_CHUNK),
        });
    }
    return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────────────────────────
async function embedBatch(texts) {
    const all = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch    = texts.slice(i, i + EMBED_BATCH);
        const response = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
        const sorted   = response.data.sort((a, b) => a.index - b.index);
        all.push(...sorted.map(e => e.embedding));
        if (i + EMBED_BATCH < texts.length) await new Promise(r => setTimeout(r, 100));
    }
    return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert
// ─────────────────────────────────────────────────────────────────────────────
async function upsertBibleChunks(docs) {
    if (!docs || docs.length === 0) return 0;
    const ops = docs.map(doc => ({
        updateOne: {
            filter: { book: doc.book, chapter: doc.chapter, chunkIndex: doc.chunkIndex },
            update: { $set: doc },
            upsert: true,
        },
    }));
    const result = await BibleChunk.bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    const wipe       = process.argv.includes('--wipe');
    const reportOnly = process.argv.includes('--report');

    console.log('📖 Te Tuvalu RAG — Tuvaluan Bible Ingestion (v2)');
    console.log('=================================================\n');

    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    console.log('✅ MongoDB connected\n');

    if (reportOnly) {
        const total = await BibleChunk.countDocuments();
        const books = await BibleChunk.distinct('book');
        console.log(`📊 Bible chunks in DB: ${total} across ${books.length} books`);
        for (const book of books.sort()) {
            const chaps = (await BibleChunk.distinct('chapter', { book })).length;
            const cnt   = await BibleChunk.countDocuments({ book });
            console.log(`   ${book}: ${chaps} chapters, ${cnt} chunks`);
        }
        await mongoose.disconnect();
        return;
    }

    if (wipe) {
        console.log('🗑️  Dropping bible_chunks collection…');
        await mongoose.connection.db.collection('biblechunks').drop().catch(() => {});
        console.log('   ↳ Dropped\n');
    }

    await BibleChunk.ensureIndexes();
    const existingBooks = wipe ? new Set() : new Set(await BibleChunk.distinct('book'));

    // Parse PDF
    const biblePath = path.join(PDF_DIR, BIBLE_FILE);
    console.log(`📄 Parsing ${BIBLE_FILE} (${(fs.statSync(biblePath).size / 1e6).toFixed(1)}MB)…`);
    const buffer = fs.readFileSync(biblePath);
    const parsed = await pdfParse(buffer);
    console.log(`   ✓ ${parsed.numpages} pages, ${(parsed.text.length / 1e6).toFixed(2)}M characters\n`);

    console.log('🔍 Parsing book/chapter/verse structure…');
    const sections = parseBibleText(parsed.text);

    // Group by book
    const bookMap = new Map();
    for (const sec of sections) {
        if (!bookMap.has(sec.book)) bookMap.set(sec.book, []);
        bookMap.get(sec.book).push(sec);
    }
    console.log(`   ✓ Parsed ${sections.length} chapters across ${bookMap.size} books\n`);

    // Stats
    const stats = {
        booksProcessed:    0,
        chaptersProcessed: 0,
        chunksCreated:     0,
        skippedBooks:      0,
        errors:            [],
    };

    // Process book by book
    for (const [bookName, bookSections] of bookMap) {
        if (existingBooks.has(bookName)) {
            stats.skippedBooks++;
            continue;
        }

        const bookNum = bookSections[0]?.bookNumber || 0;
        process.stdout.write(`  ⏳ ${bookName} (${bookSections.length} chapters)…`);

        try {
            const allChunks = [];
            for (const sec of bookSections) {
                const chunks = chunkVerses(sec.verses);
                for (const vc of chunks) {
                    allChunks.push({
                        ...vc,
                        book:       bookName,
                        bookNumber: bookNum,
                        chapter:    sec.chapter,
                        language:   'tv',
                    });
                }
            }

            if (allChunks.length === 0) {
                console.log(' ⚠ 0 chunks (verses may be missing)');
                continue;
            }

            const embeddings = await embedBatch(allChunks.map(c => c.text));
            const docs = allChunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] }));
            const saved = await upsertBibleChunks(docs);

            console.log(` ✓ ${allChunks.length} chunks (${saved} saved)`);
            stats.booksProcessed++;
            stats.chaptersProcessed += bookSections.length;
            stats.chunksCreated     += allChunks.length;
        } catch (err) {
            console.log(` ✗ ERROR: ${err.message}`);
            stats.errors.push({ book: bookName, error: err.message });
        }
    }

    // Post-ingest counts
    const totalStored = await BibleChunk.countDocuments();
    const booksStored = (await BibleChunk.distinct('book')).length;

    // Find books expected but not detected in PDF
    const detectedBooks = new Set([...bookMap.keys()]);
    const missingBooks  = TUVALUAN_BOOKS.filter(b => !detectedBooks.has(b.name)).map(b => b.name);

    console.log('\n═══════════════════════════════════════════════');
    console.log('📊 BIBLE INGESTION VALIDATION REPORT');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Books detected in PDF      : ${bookMap.size} / ${TUVALUAN_BOOKS.length}`);
    console.log(`  Books processed this run   : ${stats.booksProcessed}`);
    console.log(`  Books skipped (existing)   : ${stats.skippedBooks}`);
    console.log(`  Chapters processed         : ${stats.chaptersProcessed}`);
    console.log(`  Chunks created             : ${stats.chunksCreated}`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Total chunks in DB (bible) : ${totalStored}`);
    console.log(`  Total books in DB          : ${booksStored}`);
    console.log(`  Processing errors          : ${stats.errors.length}`);

    if (stats.errors.length > 0) {
        console.log('\n  ⚠ Errors:');
        stats.errors.forEach(e => console.log(`    - ${e.book}: ${e.error}`));
    }

    if (missingBooks.length > 0) {
        console.log(`\n  ⚠ Books in name list but not detected in PDF (${missingBooks.length}):`);
        missingBooks.forEach(b => process.stdout.write(`    ${b}  `));
        console.log('\n  (These may use slightly different headings — run --report after to verify)');
    } else {
        console.log('\n  ✅ All 66 Bible books detected and processed');
    }

    console.log('\n═══════════════════════════════════════════════\n');
    console.log('📌 Atlas Vector Search index (create if not exists):');
    console.log('   Collection : bible_chunks');
    console.log('   Index name : bible_vector_index');
    console.log('   Field      : embedding (vector, cosine, 1536 dims)\n');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
