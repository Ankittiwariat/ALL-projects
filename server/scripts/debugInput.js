import 'dotenv/config';
import mongoose from 'mongoose';
import Chat from '../models/Chat.js';

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    const chat = await Chat.findOne().sort({ updatedAt: -1 }).lean();
    
    // Look at the "They celebrated..." message
    const msg = chat.messages.find(m => m.content.includes("They celebrated"));
    if (msg) {
        console.log("Raw user content:");
        console.log(JSON.stringify(msg.content));
        
        // Extract just the text part (after the bold label)
        const textPart = msg.content.split('\n\n')[1];
        console.log("Extracted textPart:");
        console.log(JSON.stringify(textPart));
        
        const norm = normalizeText(textPart);
        console.log("Normalized:");
        console.log(JSON.stringify(norm));
        
        const expected = "they celebrated their tenth wedding anniversary with family and friends";
        console.log("Expected:");
        console.log(JSON.stringify(expected));
        
        console.log("Match?", norm === expected);
        if (norm !== expected) {
            for(let i=0; i<Math.max(norm.length, expected.length); i++) {
                if (norm[i] !== expected[i]) {
                    console.log(`Mismatch at ${i}: norm='${norm[i]}' (${norm.charCodeAt(i)}) vs exp='${expected[i]}' (${expected.charCodeAt(i)})`);
                    break;
                }
            }
        }
    }
    process.exit(0);
}
main();
