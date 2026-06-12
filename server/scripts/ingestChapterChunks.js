/**
 * Te Tuvalu RAG — Chapter PDF Ingestion Script (Phase 2 - ChapterChunks)
 *
 * Architecture:
 *  1. Parse EN and TV PDFs.
 *  2. Extract paragraphs (40-200 words).
 *  3. Embed snippetText (first ~30-60 words) for both EN and TV.
 *  4. Semantic Alignment: Compute cosine similarity matrix between EN and TV snippets,
 *     and greedily match the best pairs.
 *  5. Store as Parent-Child chunks in ChapterChunks collection.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import ChapterChunk from '../models/ChapterChunk.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR       = path.resolve(__dirname, '../datasets/raw-pdfs');
const EMBED_MODEL   = 'text-embedding-3-small';
const EMBED_BATCH   = 20;
const MIN_WORDS     = 40;
const MAX_WORDS     = 200;
const OVERLAP_WORDS = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHAPTER_PAIRS = [
    { chapterId: 'Chapter 1', chapterTitle: 'Te Fenua ko Nanumea', en: 'Chapter 1 English Lang - Te Fenua ko Nanumea.pdf', tv: 'Chapter 1 Tuvalu Lang - Te Fenua ko Nanumea.pdf' },
    { chapterId: 'Chapter 2', chapterTitle: 'Fakavae akenga o faigaiga aliki o Nanumea', en: 'Chapter 2 English Lang - Fakavae akenga o faigaiga aliki o Nanumea.pdf', tv: 'Chapter 2 Tuvalu lang - Fakavae akenga o faifaiga aliki o Nanumea.pdf' },
    { chapterId: 'Chapter 3', chapterTitle: 'Te loto o te Fenua', en: 'Chapter 3 English Lang - te loto o te fenua.pdf', tv: 'Chapter 3 Tuvalu Lang - Te loto o te Fenua.pdf' },
    { chapterId: 'Chapter 4', chapterTitle: 'Pulepulega o te Fenua', en: 'Chapter 4 English Lang - pulepulega o te fenua.pdf', tv: 'Chapter 4 Tuvalu Lang - Pulepulega o te feanua.pdf' },
    { chapterId: 'Chapter 5', chapterTitle: 'Mataupu 5', en: 'Chapter 5 English lang- Mataupu 5.pdf', tv: 'Chapter 5 Tuvalu Lang - Mataupu 5.pdf' },
    { chapterId: 'Chapter 6', chapterTitle: 'Mataupu 6', en: 'Chapter 6 English Lang - Mataupu 6.pdf', tv: 'Chapter 6 Tuvalu Lang - Mataupu 6.pdf' },
    { chapterId: 'Chapter 7', chapterTitle: 'Mataupu 7', en: 'Chapter 7 English Lang - Mataupu 7.pdf', tv: 'Chapter 7 Tuvalu lang - Mataupu 7.pdf' },
    { chapterId: 'Chapter 8', chapterTitle: 'Mataupu 8', en: 'Chapter 8 English lang - Mataupu 8.pdf', tv: 'Chapter 8 Tuvalu Lang- Mataupu 8.pdf' },
    { chapterId: 'Chapter 9', chapterTitle: 'Mataupu 9', en: 'Chapter 9, English lang - Mataupu 9.pdf', tv: 'Chapter 9, Tuvalu lang - Mataupu 9.pdf' },
    { chapterId: 'Chapter 10', chapterTitle: 'Ika mo te Faiva / Fish and Fishing', en: 'Chapter 10, English Lang Mataupu 10.pdf', tv: 'Chapter 10, Tuvalu Lang - Mataupu 10.pdf' },
    { chapterId: 'Chapter 11', chapterTitle: 'Mataupu 11', en: 'Chapter 11 English language - Mataupu 11.pdf', tv: 'Chapter 11 Tuvalu lang - Mataupu 11.pdf' },
    { chapterId: 'Chapter 12', chapterTitle: 'Mataupu 12', en: 'Chapter 12 English lang - Mataupu 12.pdf', tv: 'Chapter 12 Tuvalu lang - Mataupu 12.pdf' },
    // Chapter 13 excluded
    { chapterId: 'Chapter 14', chapterTitle: 'Mataupu 14', en: 'Chapter 14, English Lang - Mataupu 14.pdf', tv: 'Chapter 14 Tuvalu Lang - Mataupu 14.pdf' },
    { chapterId: 'Chapter 15', chapterTitle: 'Mataupu 15', en: 'Chapter 15, English Lang - Mataupu 15.pdf', tv: 'Chapter 15, Tuvalu Lang - Mataupu 15.pdf' },
    { chapterId: 'Chapter 16', chapterTitle: 'Mataupu 16', en: 'Chapter 16, English Lang - Mataupu 16.pdf', tv: 'Chapter 16 Tuvalu Lang - Mataupu 16.pdf' },
    { chapterId: 'Chapter 17', chapterTitle: 'Mataupu 17', en: 'Chapter 17 English lang - Mataupu 17.pdf', tv: 'Chapter 17 Tuvalu lang - Mataupu 17.pdf' },
];

function extractParagraphs(rawText) {
    const text = rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const rawParas = text.split(/\n\n+/).map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

    const merged = [];
    let buffer = '';
    for (const para of rawParas) {
        const combined = buffer ? `${buffer} ${para}` : para;
        const wordCount = combined.split(/\s+/).length;
        if (wordCount < MIN_WORDS) {
            buffer = combined;
        } else {
            merged.push(combined);
            buffer = '';
        }
    }
    if (buffer) merged.push(buffer);

    const final = [];
    for (const para of merged) {
        const words = para.split(/\s+/);
        if (words.length <= MAX_WORDS) {
            final.push(para);
            continue;
        }
        let start = 0;
        while (start < words.length) {
            const end = Math.min(start + MAX_WORDS, words.length);
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

// Extract first 2 sentences for the snippet
function getSnippet(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.slice(0, 2).join(' ').trim();
}

async function embedBatch(texts) {
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        const response = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
        const sorted = response.data.sort((a, b) => a.index - b.index);
        allEmbeddings.push(...sorted.map(e => e.embedding));
    }
    return allEmbeddings;
}

// Cosine similarity
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function parsePdf(filename) {
    const buffer = fs.readFileSync(path.join(PDF_DIR, filename));
    const result = await pdfParse(buffer);
    return result.text;
}

async function processChapterPair(pair) {
    const { chapterId, chapterTitle, en: enFile, tv: tvFile } = pair;
    
    let enText = await parsePdf(enFile);
    let tvText = await parsePdf(tvFile);

    const enParas = extractParagraphs(enText);
    const tvParas = extractParagraphs(tvText);

    if (enParas.length === 0 || tvParas.length === 0) {
        throw new Error(`No paragraphs extracted: EN=${enParas.length} TV=${tvParas.length}`);
    }

    const enSnippets = enParas.map(p => getSnippet(p));
    // Prepend TUVALUAN: to help the model identify language context
    const tvSnippets = tvParas.map(p => 'TUVALUAN: ' + getSnippet(p));

    const [enEmbeddings, tvEmbeddings] = await Promise.all([
        embedBatch(enSnippets),
        embedBatch(tvSnippets)
    ]);

    // Build the docs without alignments yet
    const enDocs = enParas.map((fullText, i) => ({
        _id: new mongoose.Types.ObjectId(), // pre-generate IDs for linking
        chapterId, chapterTitle, language: 'en',
        chunkIndex: i, fullText, snippetText: enSnippets[i],
        embedding: enEmbeddings[i], source: enFile,
        alignedChunkId: null, alignedFullText: null, alignmentScore: null
    }));

    const tvDocs = tvParas.map((fullText, i) => ({
        _id: new mongoose.Types.ObjectId(),
        chapterId, chapterTitle, language: 'tv',
        chunkIndex: i, fullText, snippetText: tvSnippets[i].replace('TUVALUAN: ', ''),
        embedding: tvEmbeddings[i], source: tvFile,
        alignedChunkId: null, alignedFullText: null, alignmentScore: null
    }));

    // Semantic Alignment: greedy matching
    // We compute a matrix of scores, then iteratively pick the best pair
    let matches = [];
    for (let i = 0; i < enDocs.length; i++) {
        for (let j = 0; j < tvDocs.length; j++) {
            matches.push({
                enIdx: i,
                tvIdx: j,
                score: cosineSimilarity(enDocs[i].embedding, tvDocs[j].embedding)
            });
        }
    }
    matches.sort((a, b) => b.score - a.score);

    const claimedEn = new Set();
    const claimedTv = new Set();

    for (const match of matches) {
        if (claimedEn.has(match.enIdx) || claimedTv.has(match.tvIdx)) continue;
        
        // Match found!
        claimedEn.add(match.enIdx);
        claimedTv.add(match.tvIdx);

        const enDoc = enDocs[match.enIdx];
        const tvDoc = tvDocs[match.tvIdx];

        enDoc.alignedChunkId = tvDoc._id;
        enDoc.alignedFullText = tvDoc.fullText;
        enDoc.alignmentScore = match.score;

        tvDoc.alignedChunkId = enDoc._id;
        tvDoc.alignedFullText = enDoc.fullText;
        tvDoc.alignmentScore = match.score;
    }

    return [...enDocs, ...tvDocs];
}

async function main() {
    console.log('🚀 Te Tuvalu RAG — Phase 2: Chapter Ingestion (Semantic Alignment)\n');
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected');

    await ChapterChunk.deleteMany({}); // wipe for clean slate
    console.log('🗑️ Wiped ChapterChunk collection\n');

    let totalSaved = 0;

    for (const pair of CHAPTER_PAIRS) {
        process.stdout.write(`📖 Processing ${pair.chapterId}... `);
        try {
            const docs = await processChapterPair(pair);
            await ChapterChunk.insertMany(docs);
            console.log(`✓ ${docs.length} chunks saved`);
            totalSaved += docs.length;
        } catch (err) {
            console.log(`✗ ERROR: ${err.message}`);
        }
    }

    console.log(`\n✅ Finished! Total ChapterChunks saved: ${totalSaved}`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
