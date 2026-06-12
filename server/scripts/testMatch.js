import 'dotenv/config';
import mongoose from 'mongoose';
import PhrasePair from '../models/PhrasePair.js';

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    const input = "They celebrated their tenth wedding anniversary with family and friends.";
    const norm = normalizeText(input);
    console.log("Normalized input:", norm);
    
    const exactMatch = await PhrasePair.findOne({ normalizedEn: norm }).lean();
    console.log("Exact match:", exactMatch ? "FOUND" : "NOT FOUND");
    
    // Let's see what's actually in DB for a similar string
    const regexMatch = await PhrasePair.findOne({ english: { $regex: /tenth wedding anniversary/i } }).lean();
    if (regexMatch) {
        console.log("DB normalizedEn:", regexMatch.normalizedEn);
        console.log("DB english:", regexMatch.english);
        console.log("DB tuvaluan:", regexMatch.tuvaluan);
        console.log("Equal?", norm === regexMatch.normalizedEn);
    } else {
        console.log("Regex match not found!");
    }
    process.exit(0);
}
main();
