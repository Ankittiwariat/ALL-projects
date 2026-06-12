import 'dotenv/config';
import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import DictionaryEntry from './models/DictionaryEntry.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = 'text-embedding-3-small';

async function test() {
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('Connected.');
    
    const words = ['name', 'ankit'];
    const embResponse = await openai.embeddings.create({ model: EMBED_MODEL, input: words });
    const wordEmbeddings = embResponse.data.sort((a, b) => a.index - b.index).map(e => e.embedding);
    
    for (let i = 0; i < words.length; i++) {
        console.log(`\nSearching for: ${words[i]}`);
        const pipeline = [
            { $vectorSearch: { index: 'dictionary_vector_index', path: 'embedding', queryVector: wordEmbeddings[i], numCandidates: 30, limit: 3 } },
            { $project: { headword: 1, definition: 1, score: { $meta: 'vectorSearchScore' } } }
        ];
        const results = await DictionaryEntry.aggregate(pipeline);
        results.forEach(r => console.log(`  [${r.score.toFixed(3)}] ${r.headword} — ${r.definition}`));
    }
    await mongoose.disconnect();
}
test().catch(console.error);
