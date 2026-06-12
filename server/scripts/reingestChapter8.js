import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { OpenAI } from 'openai';
import DocumentChunk from '../models/DocumentChunk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR   = path.resolve(__dirname, '../datasets/raw-pdfs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MAX_WORDS = 250;
const MIN_WORDS = 20;
const OVERLAP_WORDS = 50;

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

async function embedBatch(texts) {
    if (!texts || texts.length === 0) return [];
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts
    });
    return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    console.log('📝 Re-ingesting Chapter 8...');

    const chapterDef = {
        enPath: 'Chapter 8 English lang - Mataupu 8.pdf',
        tvPath: 'Chapter 8 Tuvalu Lang- Mataupu 8.pdf',
        chapterId: 'Chapter 8'
    };

    const enBuf = fs.readFileSync(path.join(PDF_DIR, chapterDef.enPath));
    const tvBuf = fs.readFileSync(path.join(PDF_DIR, chapterDef.tvPath));
    const enRes = await pdfParse(enBuf);
    const tvRes = await pdfParse(tvBuf);

    const enParas = extractParagraphs(enRes.text);
    const tvParas = extractParagraphs(tvRes.text);

    console.log(`Extracted: ${enParas.length} EN paragraphs | ${tvParas.length} TV paragraphs`);

    const enEmbeddings = await embedBatch(enParas);
    const tvEmbeddings = await embedBatch(tvParas);

    const enDocs = enParas.map((p, i) => ({
        text: p,
        embedding: enEmbeddings[i],
        source: chapterDef.enPath,
        chapterId: chapterDef.chapterId,
        language: 'en',
        chunkIndex: i
    }));

    const tvDocs = tvParas.map((p, i) => ({
        text: p,
        embedding: tvEmbeddings[i],
        source: chapterDef.tvPath,
        chapterId: chapterDef.chapterId,
        language: 'tv',
        chunkIndex: i
    }));

    // Bilingual pairing up to the smaller length
    const pairDocs = [];
    const minLen = Math.min(enParas.length, tvParas.length);
    for (let i = 0; i < minLen; i++) {
        const combinedText = `ENGLISH:\n${enParas[i]}\n\nTUVALUAN:\n${tvParas[i]}`;
        pairDocs.push({
            text: combinedText,
            source: chapterDef.enPath + ' | ' + chapterDef.tvPath,
            chapterId: chapterDef.chapterId,
            language: 'bilingual',
            chunkIndex: i
        });
    }
    const pairEmbeddings = await embedBatch(pairDocs.map(d => d.text));
    pairDocs.forEach((d, i) => { d.embedding = pairEmbeddings[i]; });

    const allDocs = [...enDocs, ...tvDocs, ...pairDocs];
    if (allDocs.length > 0) {
        await DocumentChunk.insertMany(allDocs);
    }

    console.log(`✅ Chapter 8 synced! Total chunks saved: ${allDocs.length}`);
    await mongoose.disconnect();
}

main().catch(console.error);
