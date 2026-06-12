/**
 * Ingests additional phrase table PDFs that have a different format:
 *   1. English Phrase
 *   Tuvaluan Translation
 *   (Tuvaluan translation continuation...)
 */

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

const EXTRA_FILES = [
    'Tuvaluan_Sports_Phrases.docx.pdf',
    'Tuvaluan_Singing_Music_Phrases.docx.pdf',
    'Tuvaluan_Family_Phrases.docx.pdf'
];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parsePhrases(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const pairs = [];
    
    let currentEn = null;
    let currentTv = [];
    
    const flush = () => {
        if (currentEn && currentTv.length > 0) {
            pairs.push({
                text: `${currentEn}\n${currentTv.join(' ')}`,
                language: 'bilingual'
            });
        }
    };
    
    for (const line of lines) {
        // Skip headers
        if (/English to Tuvaluan/i.test(line) || /Phrases/i.test(line) || /Translation/i.test(line) || /Good luck/i.test(line)) {
            continue;
        }
        
        const match = line.match(/^\d+\.\s+(.+)$/);
        if (match) {
            // New phrase starts
            flush();
            currentEn = match[1].trim();
            currentTv = [];
        } else if (currentEn) {
            // Continuation of Tuvaluan phrase
            currentTv.push(line);
        }
    }
    flush();
    
    return pairs;
}

async function main() {
    console.log('📝 Ingesting Extra Phrase Tables...\n');
    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    
    let totalSaved = 0;
    
    for (const filename of EXTRA_FILES) {
        console.log(`Processing: ${filename}...`);
        const buf = fs.readFileSync(path.join(PDF_DIR, filename));
        const res = await pdfParse(buf);
        
        const pairs = parsePhrases(res.text);
        if (pairs.length === 0) {
            console.log(` ⚠ No pairs found in ${filename}`);
            continue;
        }
        
        // Remove old chunks from this source just in case
        await DocumentChunk.deleteMany({ source: filename });
        
        // Embed
        const texts = pairs.map(p => p.text);
        const embeddingsResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: texts
        });
        
        const sorted = embeddingsResponse.data.sort((a, b) => a.index - b.index);
        
        const docs = pairs.map((p, idx) => ({
            text: p.text,
            embedding: sorted[idx].embedding,
            source: filename,
            language: 'bilingual',
            chunkIndex: idx,
            chapterTitle: filename.replace('.docx.pdf', '').replace(/_/g, ' ')
        }));
        
        await DocumentChunk.insertMany(docs);
        console.log(` ✓ Saved ${docs.length} phrase pairs.\n`);
        totalSaved += docs.length;
    }
    
    console.log(`✅ Finished! Total phrase pairs saved: ${totalSaved}`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
