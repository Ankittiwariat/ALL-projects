import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const Chunk = (await import('./models/DocumentChunk.js')).default;
    const chunk = await Chunk.findOne({ text: /Sa logoa tamaliki/i });
    console.log(JSON.stringify(chunk, null, 2));
    process.exit(0);
});
