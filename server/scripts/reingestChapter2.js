import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import ChapterChunk from '../models/ChapterChunk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR   = path.resolve(__dirname, '../datasets/raw-pdfs');
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_BATCH = 20;
const MIN_WORDS = 40;
const MAX_WORDS = 200;
const OVERLAP_WORDS = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const chapterPair = { 
    chapterId: 'Chapter 2', 
    chapterTitle: 'Fakavae akenga o faigaiga aliki o Nanumea', 
    en: 'Chapter 2 English Lang - Fakavae akenga o faigaiga aliki o Nanumea.pdf', 
    tv: 'Chapter 2 Tuvalu lang - Fakavae akenga o faifaiga aliki o Nanumea.pdf' 
};

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

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
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
    const tvSnippets = tvParas.map(p => 'TUVALUAN: ' + getSnippet(p));

    const [enEmbeddings, tvEmbeddings] = await Promise.all([
        embedBatch(enSnippets),
        embedBatch(tvSnippets)
    ]);

    const enDocs = enParas.map((fullText, i) => ({
        _id: new mongoose.Types.ObjectId(),
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

    let matches = [];
    for (let i = 0; i < enDocs.length; i++) {
        for (let j = 0; j < tvDocs.length; j++) {
            matches.push({
                enIdx: i, tvIdx: j,
                score: cosineSimilarity(enDocs[i].embedding, tvDocs[j].embedding)
            });
        }
    }
    matches.sort((a, b) => b.score - a.score);

    const claimedEn = new Set();
    const claimedTv = new Set();

    for (const match of matches) {
        if (claimedEn.has(match.enIdx) || claimedTv.has(match.tvIdx)) continue;
        claimedEn.add(match.enIdx);
        claimedTv.add(match.tvIdx);

        enDocs[match.enIdx].alignedChunkId = tvDocs[match.tvIdx]._id;
        enDocs[match.enIdx].alignedFullText = tvDocs[match.tvIdx].fullText;
        enDocs[match.enIdx].alignmentScore = match.score;

        tvDocs[match.tvIdx].alignedChunkId = enDocs[match.enIdx]._id;
        tvDocs[match.tvIdx].alignedFullText = enDocs[match.enIdx].fullText;
        tvDocs[match.tvIdx].alignmentScore = match.score;
    }

    return [...enDocs, ...tvDocs];
}

async function main() {
    console.log('🚀 Re-ingesting Chapter 2...\n');
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected');

    // Remove existing chunks for Chapter 2
    await ChapterChunk.deleteMany({ chapterId: 'Chapter 2' });
    console.log('🗑️ Wiped old Chapter 2 chunks');

    try {
        const docs = await processChapterPair(chapterPair);
        await ChapterChunk.insertMany(docs);
        console.log(`✓ ${docs.length} chunks saved for Chapter 2`);
    } catch (err) {
        console.log(`✗ ERROR: ${err.message}`);
    }

    console.log(`\n✅ Finished re-ingesting Chapter 2`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
