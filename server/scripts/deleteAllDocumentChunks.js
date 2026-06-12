import 'dotenv/config';
import mongoose from 'mongoose';
import DocumentChunk from '../models/DocumentChunk.js';
import ChapterChunk from '../models/ChapterChunk.js';

async function main() {
    try {
        await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
        console.log('✅ MongoDB connected');

        // Delete all DocumentChunks
        const docResult = await DocumentChunk.deleteMany({});
        console.log(`🗑️ Deleted ${docResult.deletedCount} items from DocumentChunk.`);

        // Delete all ChapterChunks (if any were used for the old dataset)
        const chapterResult = await ChapterChunk.deleteMany({});
        console.log(`🗑️ Deleted ${chapterResult.deletedCount} items from ChapterChunk.`);

        console.log('✅ All old dataset chunks have been cleared from the database.');
    } catch (err) {
        console.error('Error clearing database:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 MongoDB disconnected');
    }
}

main().catch(console.error);
