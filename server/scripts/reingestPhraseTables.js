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

async function main() {
    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    console.log('📝 Re-ingesting standard phrase tables due to regex bug...');

    const phrasePdfs = [
        'tuvaluan_phrases.docx.pdf',
        'tuvaluan_phrases2.docx.pdf',
        'tuvaluan_phrases3.docx.pdf',
        'tuvaluan_phrases4.docx.pdf',
        'tuvalu_phrases_love and health.docx.pdf',
        'tuvaluan_phrases6.docx.pdf',
        'tuvaluan_phrases7.docx.pdf',
        'tuvaluan_phrases8.docx.pdf',
        'tuvaluan_phrases9.docx.pdf',
        'tuvaluan_phrases10.docx.pdf',
        'tuvaluan_phrases11.docx.pdf'
    ];

    let totalSaved = 0;
    for (const filename of phrasePdfs) {
        process.stdout.write(`  ⏳ ${filename}...`);
        
        const fullPath = path.join(PDF_DIR, filename);
        if (!fs.existsSync(fullPath)) {
            console.log(` ❌ File not found`);
            continue;
        }

        const buf = fs.readFileSync(fullPath);
        const res = await pdfParse(buf);
        const pairs = parseBilingualTable(res.text);
        
        if (!pairs) {
            console.log(' ⚠ No phrase pairs found');
            continue;
        }

        await DocumentChunk.deleteMany({ source: filename });

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
        console.log(` ✓ Saved ${docs.length} pairs`);
        totalSaved += docs.length;
    }
    
    console.log(`\n✅ Finished! Re-ingested ${totalSaved} total phrase pairs.`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
