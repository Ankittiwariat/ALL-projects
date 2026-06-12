import 'dotenv/config';
import mongoose from 'mongoose';
import PhrasePair from '../models/PhrasePair.js';
import ChapterChunk from '../models/ChapterChunk.js';

async function main() {
    try {
        await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
        console.log('Connected to MongoDB');

        await PhrasePair.createCollection();
        console.log('Created phrase_pairs collection successfully.');

        await ChapterChunk.createCollection();
        console.log('Created chapter_chunks collection successfully.');

        process.exit(0);
    } catch (e) {
        console.error('Error (they might already exist):', e.message);
        process.exit(0);
    }
}

main();
