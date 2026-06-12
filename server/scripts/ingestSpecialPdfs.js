import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';

// We have to bypass pdf-parse's broken index.js in this env
const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MONGO_URI = process.env.MONGODB_URI + '/te_tuvalu_gpt';
const PDF_DIR = path.join(process.cwd(), 'datasets', 'raw-pdfs');

const SPECIAL_FILES = [
    'English_Tuvaluan_Practice.docx.pdf',
    'English_Tuvaluan_Set2.docx.pdf',
    'Tuvaluan_Family_Phrases.docx.pdf',
    'Tuvaluan_Singing_Music_Phrases.docx.pdf',
    'Tuvaluan_Sports_Phrases.docx.pdf',
    'tuvalu_phrases_love and health.docx.pdf'
];

async function extractPairsWithAI(text) {
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

async function embedBatch(texts) {
    if (texts.length === 0) return [];
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: texts,
        });
        return response.data.map(d => d.embedding);
    } catch (err) {
        console.error('Embedding failed:', err.message);
        return [];
    }
}

async function processPdf(filename, DocumentChunk) {
    console.log(`\n⏳ Processing: ${filename}…`);
    const filePath = path.join(PDF_DIR, filename);

    // 1. Check if already ingested (we'll just delete existing chunks for this file to be safe)
    await DocumentChunk.deleteMany({ source: filename });

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
    const pairs = await extractPairsWithAI(parsedText);
    
    if (pairs.length === 0) {
        console.warn(`  ⚠  No pairs found in ${filename}`);
        return;
    }

    console.log(`  ✅ Found ${pairs.length} pairs. Embedding and saving...`);

    // 4. Create chunks (1 pair per chunk)
    const chunksData = pairs.map(p => ({
        text: `${p.en}\n${p.tv}`,
        language: 'bilingual',
    }));

    // 5. Embed and save
    const textsToEmbed = chunksData.map(c => c.text);
    const embeddings = await embedBatch(textsToEmbed);

    const docsToInsert = chunksData.map((chunk, idx) => ({
        text: chunk.text,
        embedding: embeddings[idx],
        source: filename,
        language: 'bilingual',
        chapterId: null,
        chunkIndex: idx,
    }));

    await DocumentChunk.insertMany(docsToInsert);
    console.log(`  ✓ Saved ${docsToInsert.length} bilingual chunks for ${filename}`);
}

async function main() {
    console.log('🚀 Te Tuvalu RAG — Special Bilingual PDF Ingestion\n========================================');
    
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');

    const DocumentChunkSchema = new mongoose.Schema({
        text: { type: String, required: true },
        embedding: { type: [Number], required: true },
        source: { type: String, required: true, index: true },
        language: { type: String, enum: ['en', 'tv', 'bilingual'], required: true, index: true },
        chapterId: { type: String, default: null, index: true },
        chunkIndex: { type: Number, required: true },
    });
    
    const DocumentChunk = mongoose.models.DocumentChunk || mongoose.model('DocumentChunk', DocumentChunkSchema, 'documentchunks');

    for (const file of SPECIAL_FILES) {
        await processPdf(file, DocumentChunk);
    }

    console.log('\n✅ All special PDFs processed step by step!');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
