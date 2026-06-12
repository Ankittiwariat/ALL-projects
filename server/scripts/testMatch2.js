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
    
    // The exact text the user typed in the screenshot
    const userTvText = "Ne fakatasi atu kaiga mo taugasoa o fakamanatu fakatasi te sefulu tausaga ote olaga nofo kaiga o laua";
    const norm = normalizeText(userTvText);
    console.log("User normalizedTv:", norm);
    
    const exactMatch = await PhrasePair.findOne({ normalizedTv: norm }).lean();
    console.log("Exact match (tv):", exactMatch ? "FOUND" : "NOT FOUND");
    
    // Look it up using English to see what TV actually looks like in DB
    const enText = "They celebrated their tenth wedding anniversary with family and friends.";
    const pair = await PhrasePair.findOne({ normalizedEn: normalizeText(enText) }).lean();
    if (pair) {
        console.log("DB Tuvaluan:", pair.tuvaluan);
        console.log("DB normalizedTv:", pair.normalizedTv);
        console.log("Length of user norm:", norm.length);
        console.log("Length of DB norm:", pair.normalizedTv.length);
        for(let i=0; i<Math.max(norm.length, pair.normalizedTv.length); i++){
            if(norm[i] !== pair.normalizedTv[i]){
                console.log(`Mismatch at ${i}: user='${norm[i]}' (${norm.charCodeAt(i)}) vs DB='${pair.normalizedTv[i]}' (${pair.normalizedTv.charCodeAt(i)})`);
                break;
            }
        }
    }
    
    process.exit(0);
}
main();
