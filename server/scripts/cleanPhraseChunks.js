/**
 * One-time cleanup script: deletes incorrectly-labeled phrase chunks
 * so they can be re-ingested properly as bilingual (split en/tv).
 * Run: node scripts/cleanPhraseChunks.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI + '/te_tuvalu_gpt';

async function main() {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    const result = await mongoose.connection.collection('documentchunks').deleteMany({
        source: { $regex: 'tuvaluan_phrases', $options: 'i' }
    });

    console.log(`🗑  Deleted ${result.deletedCount} old phrase chunks`);
    await mongoose.disconnect();
    console.log('Done. Now run: node scripts/ingestData.js');
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
