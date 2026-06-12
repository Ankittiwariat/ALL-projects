import 'dotenv/config';
import mongoose from 'mongoose';
import DocumentChunk from '../models/DocumentChunk.js';

async function main() {
    await mongoose.connect(`${process.env.MONGODB_URI}/te_tuvalu_gpt`);
    console.log('✅ MongoDB connected');

    const filesToDelete = [
        'English_Tuvaluan_Practice.docx.pdf',
        'English_Tuvaluan_Set2.docx.pdf',
        'tuvalu news.docx.pdf',
        'tuvalu_phrases_love and health.docx.pdf'
    ];

    const result = await DocumentChunk.deleteMany({ source: { $in: filesToDelete } });
    console.log(`🗑️ Deleted ${result.deletedCount} chunks for the specified files.`);

    await mongoose.disconnect();
}

main().catch(console.error);
