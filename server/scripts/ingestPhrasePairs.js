import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import PhrasePair from '../models/PhrasePair.js';

// Bypass pdf-parse's broken index.js in this env
const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MONGO_URI = process.env.MONGODB_URI + '/te_tuvalu_gpt';
const PDF_DIR = path.join(process.cwd(), 'datasets', 'raw-pdfs');

const PHRASE_FILES = [
    { file: 'tuvaluan_phrases.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases2.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases3.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases4.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases6.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases7.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases8.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases9.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases10.docx.pdf', domain: 'general' },
    { file: 'tuvaluan_phrases11.docx.pdf', domain: 'general' },
    { file: 'English_Tuvaluan_Practice.docx.pdf', domain: 'practice' },
    { file: 'English_Tuvaluan_Set2.docx.pdf', domain: 'practice' },
    { file: 'Tuvaluan_Family_Phrases.docx.pdf', domain: 'family' },
    { file: 'Tuvaluan_Singing_Music_Phrases.docx.pdf', domain: 'music' },
    { file: 'Tuvaluan_Sports_Phrases.docx.pdf', domain: 'sports' },
    { file: 'tuvalu_phrases_love and health.docx.pdf', domain: 'health' }
];

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function extractPairsWithAI(text, filename) {
    const prompt = `
You are a Tuvaluan language data extractor.
I will provide you with the raw text extracted from a PDF containing English and Tuvaluan phrase translations.
The text might be messy and have headers or footers.

Extract ONLY the translation pairs.
Return the result as a strict JSON array of objects, with exactly this format:
[
  { "en": "English phrase", "tv": "Tuvaluan phrase" },
  ...
]

Do not include markdown blocks, just the raw JSON array.
If there is no valid translation pair, return [].

Raw Text:
"""
${text}
"""
    `.trim();

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
        });

        const content = response.choices[0].message.content.trim();
        // Remove markdown formatting if the model still includes it
        const jsonStr = content.replace(/^```json/i, '').replace(/```$/i, '').trim();
        const pairs = JSON.parse(jsonStr);
        return Array.isArray(pairs) ? pairs : [];
    } catch (e) {
        console.error('AI Extraction failed:', e.message);
        return [];
    }
}

async function processPdf(fileObj) {
    const { file: filename, domain } = fileObj;
    console.log(`\n⏳ Processing: ${filename}…`);
    const filePath = path.join(PDF_DIR, filename);

    if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠ File not found: ${filePath}`);
        return;
    }

    // 1. Check if already ingested (we'll just delete existing pairs for this file to be safe)
    await PhrasePair.deleteMany({ source: filename });

    // 2. Read and parse PDF
    const buffer = fs.readFileSync(filePath);
    let parsedText;
    try {
        const result = await pdfParse(buffer);
        parsedText = result.text;
    } catch (err) {
        console.warn(`  ⚠  Failed to parse ${filename}: ${err.message}`);
        return;
    }

    // 3. Extract pairs using AI
    console.log(`  🤖 Extracting bilingual pairs using AI...`);
    const pairs = await extractPairsWithAI(parsedText, filename);
    
    if (pairs.length === 0) {
        console.warn(`  ⚠  No pairs found in ${filename}`);
        return;
    }

    console.log(`  ✅ Found ${pairs.length} pairs. Normalizing and saving...`);

    const docsToInsert = [];
    const seenEn = new Set();

    for (const p of pairs) {
        if (!p.en || !p.tv) continue;

        const normalizedEn = normalizeText(p.en);
        const normalizedTv = normalizeText(p.tv);

        if (!normalizedEn || !normalizedTv) continue;
        if (seenEn.has(normalizedEn)) continue; // avoid duplicates within the same file

        seenEn.add(normalizedEn);

        docsToInsert.push({
            english: p.en.trim(),
            tuvaluan: p.tv.trim(),
            normalizedEn,
            normalizedTv,
            domain,
            source: filename,
            confidence: 0.9, // 0.9 for AI-extracted
        });
    }

    if (docsToInsert.length > 0) {
        try {
            await PhrasePair.insertMany(docsToInsert, { ordered: false });
            console.log(`  ✓ Saved ${docsToInsert.length} bilingual phrase pairs for ${filename}`);
        } catch (err) {
            console.error(`  ✗ Error saving pairs for ${filename}:`, err.message);
        }
    } else {
        console.log(`  ⚠ No valid pairs to save for ${filename}`);
    }
}

async function main() {
    console.log('🚀 Te Tuvalu RAG — Phase 1: Phrase Pair Ingestion\n========================================');
    
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');

    for (const fileObj of PHRASE_FILES) {
        await processPdf(fileObj);
    }

    console.log('\n✅ All phrase PDFs processed!');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
