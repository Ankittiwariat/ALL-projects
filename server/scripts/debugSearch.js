/**
 * Debug script: tests what the vector search actually retrieves
 * for a given query phrase.
 * Usage: node scripts/debugSearch.js "The meeting is cancelled"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MONGO  = `${process.env.MONGODB_URI}/te_tuvalu_gpt`;
const query  = process.argv[2] || 'The meeting is cancelled';

async function main() {
    await mongoose.connect(MONGO);
    console.log(`\n🔍 Searching for: "${query}"\n`);

    const DChunk = mongoose.model('DC', new mongoose.Schema({}, { strict: false }), 'documentchunks');

    const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
    const vec = r.data[0].embedding;

    const results = await DChunk.aggregate([
        { $vectorSearch: { index: 'vector_index', path: 'embedding', queryVector: vec, numCandidates: 200, limit: 10 } },
        { $project: { text: 1, source: 1, language: 1, score: { $meta: 'vectorSearchScore' } } }
    ]);

    if (results.length === 0) {
        console.log('❌ No results returned — Atlas index may not have synced new chunks yet!');
    }

    results.forEach((r, i) => {
        console.log(`${i + 1}. [${r.score?.toFixed(4)}] [${r.language}] ${r.source}`);
        console.log(`   ${r.text.slice(0, 120).replace(/\n/g, ' / ')}\n`);
    });

    await mongoose.disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
