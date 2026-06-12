/**
 * Te Tuvalu — Dictionary Cleanup Script
 *
 * Finds and removes corrupted dictionary entries where GPT concatenated
 * English + Tuvaluan words into a single headword during ingestion.
 *
 * Patterns detected and removed:
 *  - "spouseavaga"   → English "spouse" + Tuvaluan "avaga"
 *  - "headulu"       → English "head" + Tuvaluan "ulu"
 *  - "collegekolisi" → English "college" + Tuvaluan "kolisi"
 *  - "computerkomipiuta" → concatenation
 *  - "6-11am / morningtaeao" → / separator with concatenation
 *  - Any headword with no spaces and length > 12 (almost always corrupted)
 *
 * Usage:
 *   node scripts/cleanDictionary.js          # preview bad entries
 *   node scripts/cleanDictionary.js --delete # actually delete them
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import DictionaryEntry from '../models/DictionaryEntry.js';

const DRY_RUN = !process.argv.includes('--delete');

// ─────────────────────────────────────────────────────────────────────────────
// Heuristics to detect corrupted headwords
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A headword is suspicious if it:
 * 1. Has no spaces AND length > 12 → likely English+Tuvaluan concatenation
 *    e.g. "spouseavaga", "headulu", "collegekolisi", "computerkomipiuta"
 * 2. Contains "/" → PDF parsing artifact mixing two columns
 *    e.g. "6-11am / morningtaeao", "brother / sister -in-lawse"
 * 3. Starts with a number pattern like "6-11am"
 * 4. Contains parentheses that weren't cleaned
 * 5. Ends with a 2-3 letter Tuvaluan suffix appended to an English word
 *    e.g. "injurerte", "beneficiale"
 */
function isCorrupted(entry) {
    const hw = entry.headword;
    if (!hw) return { bad: true, reason: 'empty headword' };

    const reasons = [];

    // Rule 1: No spaces + very long → almost certainly concatenated
    if (!hw.includes(' ') && hw.length > 12) {
        reasons.push(`no-space concatenation (len=${hw.length})`);
    }

    // Rule 2: Contains "/" separator
    if (hw.includes('/')) {
        reasons.push('contains "/" separator');
    }

    // Rule 3: Starts with a number or time pattern
    if (/^\d/.test(hw)) {
        reasons.push('starts with number/time');
    }

    // Rule 4: Contains parentheses (PDF artifact)
    if (hw.includes('(') || hw.includes(')')) {
        reasons.push('contains parentheses');
    }

    // Rule 5: Contains mixed script markers — English word directly concatenated
    // with Tuvaluan vowel patterns (ā,ē,ī,ō,ū in middle of otherwise ASCII word)
    // e.g. "injurerte" has no macrons but is clearly wrong
    // Detect by checking if removing a known English prefix leaves a Tuvaluan word
    const ENGLISH_PREFIXES = [
        'spouse', 'head', 'college', 'computer', 'behead', 'injure', 'morning',
        'beneficial', 'fathomless', 'fatuous', 'canine', 'school', 'church',
        'brother', 'sister', 'mother', 'father', 'husband', 'wife', 'child',
        'grand', 'uncle', 'aunt', 'cousin', 'niece', 'nephew', 'beach', 'ocean',
        'island', 'village', 'govern', 'council', 'leader', 'elder', 'chief'
    ];
    for (const prefix of ENGLISH_PREFIXES) {
        // headword starts with English prefix and has more characters after
        if (hw.toLowerCase().startsWith(prefix) && hw.length > prefix.length + 1) {
            const suffix = hw.slice(prefix.length);
            // If the suffix looks like a Tuvaluan word (3+ chars, not just 'ed', 'ing', 'er', 'ly')
            if (suffix.length >= 3 && !/^(ed|ing|er|ly|s|tion|ness|ful|less|ment|al|ize)/.test(suffix)) {
                reasons.push(`English prefix "${prefix}" + Tuvaluan suffix "${suffix}"`);
            }
        }
    }

    // Rule 6: Headword is "word1 (plural)" or "word1 (singular)" — these are often OK,
    // but headwords like "went (plural)" are valid dictionary entries. Skip.
    // Actually these are OK — they're structured entries.

    // Rule 7: Definition is "English meaning or definition here" — placeholder from GPT
    if (entry.definition && entry.definition.toLowerCase().includes('english meaning or definition here')) {
        reasons.push('placeholder definition from GPT');
    }

    // Rule 8: Headword contains a number range like "6-11am"
    if (/\d+-\d+/.test(hw)) {
        reasons.push('contains number range');
    }

    return { bad: reasons.length > 0, reasons };
}

async function main() {
    console.log('\n🔍 Te Tuvalu — Dictionary Cleanup');
    console.log('===================================');
    if (DRY_RUN) {
        console.log('⚠️  DRY RUN MODE — pass --delete to actually remove entries\n');
    } else {
        console.log('🗑️  DELETE MODE — will remove corrupted entries\n');
    }

    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    console.log('✅ MongoDB connected\n');

    const totalBefore = await DictionaryEntry.countDocuments();
    console.log(`📊 Total entries before cleanup: ${totalBefore}\n`);

    // Load all entries for inspection
    console.log('🔍 Scanning all entries for corruption...');
    const allEntries = await DictionaryEntry.find({}).lean();

    const badEntries    = [];
    const goodEntries   = [];

    for (const entry of allEntries) {
        const { bad, reasons } = isCorrupted(entry);
        if (bad) {
            badEntries.push({ entry, reasons });
        } else {
            goodEntries.push(entry);
        }
    }

    console.log(`\n📋 Found ${badEntries.length} corrupted entries:`);
    console.log(`   ${goodEntries.length} clean entries will be kept\n`);

    // Show sample of bad entries
    const showCount = Math.min(badEntries.length, 30);
    console.log(`Showing first ${showCount} corrupted entries:`);
    console.log('─'.repeat(70));
    for (const { entry, reasons } of badEntries.slice(0, showCount)) {
        console.log(`  ❌ "${entry.headword}"`);
        console.log(`     Definition: "${entry.definition?.slice(0, 60)}"`);
        console.log(`     Reason(s): ${reasons.join(', ')}`);
        console.log();
    }

    if (badEntries.length > showCount) {
        console.log(`  ... and ${badEntries.length - showCount} more\n`);
    }

    if (!DRY_RUN && badEntries.length > 0) {
        const idsToDelete = badEntries.map(b => b.entry._id);
        console.log(`\n🗑️  Deleting ${idsToDelete.length} corrupted entries...`);
        const result = await DictionaryEntry.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`✅ Deleted: ${result.deletedCount} entries`);

        const totalAfter = await DictionaryEntry.countDocuments();
        console.log(`\n📊 Summary:`);
        console.log(`   Entries before : ${totalBefore}`);
        console.log(`   Entries deleted: ${result.deletedCount}`);
        console.log(`   Entries after  : ${totalAfter}`);
        console.log(`   Retained       : ${totalAfter} clean entries`);
    } else if (DRY_RUN) {
        console.log('\n💡 Run with --delete flag to remove these entries:');
        console.log('   node scripts/cleanDictionary.js --delete\n');
    }

    await mongoose.disconnect();
    console.log('\n✅ Done.\n');
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
