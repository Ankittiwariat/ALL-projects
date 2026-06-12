import 'dotenv/config';
import mongoose from 'mongoose';
import PhrasePair from '../models/PhrasePair.js';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    const source = 'tuvalu_phrases_love and health.docx.pdf';
    const pairs = await PhrasePair.find({ source }).select('english tuvaluan -_id');
    console.log(`Found ${pairs.length} pairs for ${source}:`);
    for (const p of pairs) {
        console.log(`EN: ${p.english}\nTV: ${p.tuvaluan}\n---`);
    }
    process.exit(0);
}
main();
