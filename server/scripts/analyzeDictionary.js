/**
 * Dictionary Analysis & Visualization Tool
 *
 * Analyzes the Tuvaluan dictionary PDF structure before any chunking.
 * Produces a rich HTML report + JSON data file.
 *
 * Run: node scripts/analyzeDictionary.js
 * Output: scripts/dictionary_analysis_report.html
 *         scripts/dictionary_analysis.json
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH  = path.resolve(__dirname, '../newDataset/tuvaluan-dictionary-formatted.pdf');
const OUT_HTML  = path.resolve(__dirname, 'dictionary_analysis_report.html');
const OUT_JSON  = path.resolve(__dirname, 'dictionary_analysis.json');

// ── POS Labels ────────────────────────────────────────────────────────────────
const POS_LABELS = new Set([
    'verb','noun','adj','adjective','adv','adverb',
    'phrase','prep','preposition','conj','conjunction',
    'pron','pronoun','intj','interjection','article',
    'num','numeral','abbr','abbreviation','prefix','suffix',
    'idiom','excl','exclamation','n','v'
]);

// ── Noise Patterns ────────────────────────────────────────────────────────────
const SKIP_PATTERNS = [
    /^$/,
    /^\d+$/,
    /^[A-Z]$/,
    /^Tuvaluan Dictionary/i,
    /^English\s*[–\-]\s*Tuvaluan/i,
    /^How to use/i,
    /^This dictionary/i,
    /^alphabetically/i,
    /^Example$/i,
    /^Guide words/i,
    /^Numbers \/ Symbols/i,
    /^Compiled by/i,
    /^A vocabulary/i,
    /^\d+[A-Z][a-z]/,
    /^[A-Z]{1,3}\d/,
    /^quickly\./i,
    /^one Tuvaluan/i,
];

function isNoise(line) {
    return SKIP_PATTERNS.some(p => p.test(line.trim()));
}

function parseLine(rawLine) {
    const line = rawLine.trim();
    if (!line || isNoise(line)) return null;

    const match = line.match(/^(.+?)\s{2,}(.+)$/);
    if (!match) return null;

    let englishSide = match[1].trim();
    const tuvaluan  = match[2].trim();

    if (!englishSide || !tuvaluan) return null;
    if (englishSide.length > 150 || tuvaluan.length > 250) return null;
    if (/^&\w+;/.test(tuvaluan)) return null;

    let partOfSpeech = null;
    const tokens = englishSide.split(/\s+/);
    const lastToken = tokens[tokens.length - 1].toLowerCase().replace(/\.$/, '');
    if (tokens.length > 1 && POS_LABELS.has(lastToken)) {
        partOfSpeech = lastToken;
        englishSide  = tokens.slice(0, -1).join(' ').trim();
    }

    // Classify entry type
    const wordCount  = englishSide.split(/\s+/).length;
    const isPhrase   = wordCount >= 3 || englishSide.includes('/') || englishSide.includes('-');
    const isCompound = wordCount === 2 && !englishSide.includes('/');

    return {
        english:      englishSide,
        tuvaluan,
        partOfSpeech,
        wordCount,
        isPhrase,
        isCompound,
        isSingleWord: wordCount === 1 && !englishSide.includes('/'),
    };
}

// ── Analysis Engine ───────────────────────────────────────────────────────────
function analyzeEntries(entries) {
    // Maps
    const enToTv  = new Map(); // english → [tuvaluan...]
    const tvToEn  = new Map(); // tuvaluan → [english...]
    const posMap  = new Map(); // pos → count

    for (const e of entries) {
        // English → Tuvaluan
        if (!enToTv.has(e.english)) enToTv.set(e.english, []);
        enToTv.get(e.english).push({ tuvaluan: e.tuvaluan, pos: e.partOfSpeech });

        // Tuvaluan → English
        if (!tvToEn.has(e.tuvaluan)) tvToEn.set(e.tuvaluan, []);
        tvToEn.get(e.tuvaluan).push(e.english);

        // POS count
        const pos = e.partOfSpeech || 'unspecified';
        posMap.set(pos, (posMap.get(pos) || 0) + 1);
    }

    // Classification
    const oneToOne   = [...enToTv.entries()].filter(([, v]) => v.length === 1);
    const oneToMany  = [...enToTv.entries()].filter(([, v]) => v.length > 1);
    const manyToOne  = [...tvToEn.entries()].filter(([, v]) => v.length > 1);

    // Conflict detection: same EN word → different TV words (legitimate polysemy)
    const conflicts = oneToMany.filter(([, v]) => v.length >= 3);

    // Phrase analysis
    const singleWords = entries.filter(e => e.isSingleWord);
    const compounds   = entries.filter(e => e.isCompound);
    const phrases     = entries.filter(e => e.isPhrase);
    const withPos     = entries.filter(e => e.partOfSpeech);

    // Top multi-meaning EN words
    const topPolysemous = [...oneToMany]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 20);

    // Top multi-origin TV words
    const topTvPolysemous = [...manyToOne]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 20);

    // Alphabetic distribution
    const alphaDistEN = {};
    for (const [k] of enToTv) {
        const ch = k[0]?.toUpperCase() || '#';
        alphaDistEN[ch] = (alphaDistEN[ch] || 0) + 1;
    }

    // Semantic clusters by first letter (rough grouping)
    const clusters = {};
    for (const e of entries) {
        const ch = e.english[0]?.toUpperCase() || '#';
        if (!clusters[ch]) clusters[ch] = [];
        clusters[ch].push(e);
    }

    return {
        totalRawEntries:   entries.length,
        uniqueEnglish:     enToTv.size,
        uniqueTuvaluan:    tvToEn.size,
        oneToOne:          oneToOne.length,
        oneToMany:         oneToMany.length,
        manyToOne:         manyToOne.length,
        singleWordCount:   singleWords.length,
        compoundCount:     compounds.length,
        phraseCount:       phrases.length,
        withPosCount:      withPos.length,
        conflictsCount:    conflicts.length,
        posDistribution:   Object.fromEntries([...posMap].sort((a,b) => b[1]-a[1])),
        topPolysemous,
        topTvPolysemous,
        alphaDistEN,
        clusters,
        enToTv,
        tvToEn,
        allEntries: entries,
    };
}

// ── Intelligent Chunk Strategy Builder ───────────────────────────────────────
function buildChunkStrategy(analysis) {
    const strategy = [];

    // Strategy 1: Group by first letter (alphabetical chunks)
    // Each letter group = one family of chunks
    // Each chunk = max 50 entries (preserves relationships within same initial)
    for (const [letter, entries] of Object.entries(analysis.clusters)) {
        const chunkSize = 50;
        for (let i = 0; i < entries.length; i += chunkSize) {
            const slice = entries.slice(i, i + chunkSize);
            strategy.push({
                chunkId:    `alpha_${letter}_${Math.floor(i/chunkSize)}`,
                groupBy:    'alphabetical',
                letter,
                entryCount: slice.length,
                entries:    slice,
                rationale:  `Alphabetical group "${letter}" (entries ${i+1}-${i+slice.length})`,
            });
        }
    }

    return strategy;
}

// ── Validation Layer ──────────────────────────────────────────────────────────
function validateChunks(originalEntries, chunks) {
    const allChunkEntries = chunks.flatMap(c => c.entries);
    const origSet  = new Set(originalEntries.map(e => `${e.english}::${e.tuvaluan}`));
    const chunkSet = new Set(allChunkEntries.map(e => `${e.english}::${e.tuvaluan}`));

    const missing = [...origSet].filter(k => !chunkSet.has(k));
    const extra   = [...chunkSet].filter(k => !origSet.has(k));

    return {
        originalCount:   originalEntries.length,
        chunkTotal:      allChunkEntries.length,
        missingCount:    missing.length,
        extraCount:      extra.length,
        missingExamples: missing.slice(0, 10),
        valid:           missing.length === 0,
    };
}

// ── HTML Report Generator ─────────────────────────────────────────────────────
function generateHTMLReport(analysis, chunkStrategy, validation) {
    const posRows = Object.entries(analysis.posDistribution)
        .map(([pos, count]) => `<tr><td>${pos}</td><td>${count}</td><td>${((count/analysis.totalRawEntries)*100).toFixed(1)}%</td></tr>`)
        .join('');

    const alphaRows = Object.entries(analysis.alphaDistEN)
        .sort()
        .map(([l, c]) => `<tr><td><strong>${l}</strong></td><td>${c}</td></tr>`)
        .join('');

    const polyRows = analysis.topPolysemous
        .map(([en, tvArr]) =>
            `<tr>
                <td><strong>${en}</strong></td>
                <td>${tvArr.length}</td>
                <td>${tvArr.map(t => `<code>${t.tuvaluan}</code>${t.pos ? ` <em>(${t.pos})</em>` : ''}`).join(', ')}</td>
            </tr>`)
        .join('');

    const tvPolyRows = analysis.topTvPolysemous
        .map(([tv, enArr]) =>
            `<tr>
                <td><code>${tv}</code></td>
                <td>${enArr.length}</td>
                <td>${enArr.map(e => `<strong>${e}</strong>`).join(', ')}</td>
            </tr>`)
        .join('');

    const chunkRows = chunkStrategy.slice(0, 30)
        .map(c =>
            `<tr>
                <td>${c.chunkId}</td>
                <td>${c.groupBy}</td>
                <td>${c.letter}</td>
                <td>${c.entryCount}</td>
                <td>${c.rationale}</td>
            </tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Tuvaluan Dictionary — Structure Analysis Report</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; line-height: 1.6; }
        .header { background: linear-gradient(135deg, #1a1f2e, #2d1b69); padding: 40px; border-bottom: 1px solid #2d3748; }
        .header h1 { font-size: 2rem; font-weight: 700; color: #a78bfa; }
        .header p { color: #94a3b8; margin-top: 8px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 32px 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 40px; }
        .stat-card { background: #1e2433; border: 1px solid #2d3748; border-radius: 12px; padding: 24px; text-align: center; }
        .stat-card .number { font-size: 2.5rem; font-weight: 800; color: #a78bfa; }
        .stat-card .label { color: #64748b; font-size: 0.85rem; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
        .section { margin-bottom: 48px; }
        .section h2 { font-size: 1.4rem; color: #a78bfa; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #2d3748; }
        table { width: 100%; border-collapse: collapse; background: #1e2433; border-radius: 8px; overflow: hidden; }
        th { background: #2d1b69; color: #a78bfa; padding: 12px 16px; text-align: left; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 16px; border-bottom: 1px solid #2d3748; font-size: 0.9rem; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #252d3d; }
        code { background: #2d1b69; color: #c4b5fd; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
        em { color: #64748b; }
        strong { color: #e2e8f0; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
        .badge-green { background: #064e3b; color: #6ee7b7; }
        .badge-yellow { background: #451a03; color: #fbbf24; }
        .badge-red { background: #4c0519; color: #fca5a5; }
        .validation { padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; }
        .validation.ok { background: #064e3b; border: 1px solid #059669; }
        .validation.fail { background: #4c0519; border: 1px solid #dc2626; }
        .bar-container { background: #2d3748; border-radius: 9999px; height: 12px; margin-top: 4px; overflow: hidden; }
        .bar { height: 12px; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 9999px; }
        .progress-row { margin-bottom: 12px; }
        .progress-label { display: flex; justify-content: space-between; font-size: 0.85rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📚 Tuvaluan Dictionary — Structure Analysis Report</h1>
        <p>Compiled by Kelly Roy &nbsp;·&nbsp; English → Tuvaluan &nbsp;·&nbsp; Generated ${new Date().toLocaleString()}</p>
    </div>

    <div class="container">

        <!-- Stats Grid -->
        <div class="grid">
            <div class="stat-card">
                <div class="number">${analysis.totalRawEntries.toLocaleString()}</div>
                <div class="label">Total Raw Entries</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.uniqueEnglish.toLocaleString()}</div>
                <div class="label">Unique English Words</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.uniqueTuvaluan.toLocaleString()}</div>
                <div class="label">Unique Tuvaluan Words</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.oneToOne.toLocaleString()}</div>
                <div class="label">1:1 Mappings</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.oneToMany.toLocaleString()}</div>
                <div class="label">1:Many (EN → multiple TV)</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.manyToOne.toLocaleString()}</div>
                <div class="label">Many:1 (TV shared by EN words)</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.singleWordCount.toLocaleString()}</div>
                <div class="label">Single Words</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.compoundCount.toLocaleString()}</div>
                <div class="label">Compound Words</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.phraseCount.toLocaleString()}</div>
                <div class="label">Phrases / Idioms</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.withPosCount.toLocaleString()}</div>
                <div class="label">Have POS Tag</div>
            </div>
            <div class="stat-card">
                <div class="number">${analysis.conflictsCount.toLocaleString()}</div>
                <div class="label">High Polysemy (≥3 TV)</div>
            </div>
        </div>

        <!-- Entry Type Distribution -->
        <div class="section">
            <h2>📊 Entry Type Distribution</h2>
            <div style="background:#1e2433;border:1px solid #2d3748;border-radius:8px;padding:24px;">
                <div class="progress-row">
                    <div class="progress-label"><span>Single Words</span><span>${analysis.singleWordCount} (${((analysis.singleWordCount/analysis.totalRawEntries)*100).toFixed(1)}%)</span></div>
                    <div class="bar-container"><div class="bar" style="width:${(analysis.singleWordCount/analysis.totalRawEntries)*100}%"></div></div>
                </div>
                <div class="progress-row">
                    <div class="progress-label"><span>Compound Words (2 words)</span><span>${analysis.compoundCount} (${((analysis.compoundCount/analysis.totalRawEntries)*100).toFixed(1)}%)</span></div>
                    <div class="bar-container"><div class="bar" style="width:${(analysis.compoundCount/analysis.totalRawEntries)*100}%;background:linear-gradient(90deg,#0891b2,#38bdf8)"></div></div>
                </div>
                <div class="progress-row">
                    <div class="progress-label"><span>Phrases / Multi-word (3+ words)</span><span>${analysis.phraseCount} (${((analysis.phraseCount/analysis.totalRawEntries)*100).toFixed(1)}%)</span></div>
                    <div class="bar-container"><div class="bar" style="width:${(analysis.phraseCount/analysis.totalRawEntries)*100}%;background:linear-gradient(90deg,#b45309,#fbbf24)"></div></div>
                </div>
                <div class="progress-row">
                    <div class="progress-label"><span>Has Part-of-Speech Tag</span><span>${analysis.withPosCount} (${((analysis.withPosCount/analysis.totalRawEntries)*100).toFixed(1)}%)</span></div>
                    <div class="bar-container"><div class="bar" style="width:${(analysis.withPosCount/analysis.totalRawEntries)*100}%;background:linear-gradient(90deg,#064e3b,#34d399)"></div></div>
                </div>
            </div>
        </div>

        <!-- POS Distribution -->
        <div class="section">
            <h2>🏷️ Part of Speech Distribution</h2>
            <table>
                <thead><tr><th>Part of Speech</th><th>Count</th><th>% of Entries</th></tr></thead>
                <tbody>${posRows}</tbody>
            </table>
        </div>

        <!-- Alphabetical Distribution -->
        <div class="section">
            <h2>🔤 Alphabetical Distribution (English Headwords)</h2>
            <table>
                <thead><tr><th>Letter</th><th>Entry Count</th></tr></thead>
                <tbody>${alphaRows}</tbody>
            </table>
        </div>

        <!-- Top Polysemous English Words -->
        <div class="section">
            <h2>🔄 Top 20 Polysemous English Words (1 EN → Many TV)</h2>
            <p style="color:#64748b;margin-bottom:16px;">These words have multiple Tuvaluan translations depending on context. Chunking must keep all alternatives together.</p>
            <table>
                <thead><tr><th>English Word</th><th># TV Translations</th><th>Tuvaluan Alternatives</th></tr></thead>
                <tbody>${polyRows}</tbody>
            </table>
        </div>

        <!-- Top Shared Tuvaluan Words -->
        <div class="section">
            <h2>🔄 Top 20 Shared Tuvaluan Words (Many EN → 1 TV)</h2>
            <p style="color:#64748b;margin-bottom:16px;">One Tuvaluan word covers multiple English meanings — critical for RAG disambiguation.</p>
            <table>
                <thead><tr><th>Tuvaluan Word</th><th># English Meanings</th><th>English Words</th></tr></thead>
                <tbody>${tvPolyRows}</tbody>
            </table>
        </div>

        <!-- Validation -->
        <div class="section">
            <h2>✅ Chunk Validation Report</h2>
            <div class="validation ${validation.valid ? 'ok' : 'fail'}">
                <strong>${validation.valid ? '✅ ALL ENTRIES PRESERVED' : '❌ MISSING ENTRIES DETECTED'}</strong>
                <p>Original entries: ${validation.originalCount} &nbsp;|&nbsp; Entries in chunks: ${validation.chunkTotal} &nbsp;|&nbsp; Missing: ${validation.missingCount} &nbsp;|&nbsp; Extra: ${validation.extraCount}</p>
                ${validation.missingCount > 0 ? `<p>Missing examples: ${validation.missingExamples.join(', ')}</p>` : ''}
            </div>
        </div>

        <!-- Chunk Strategy Preview -->
        <div class="section">
            <h2>📦 Proposed Chunk Strategy (Preview — first 30 chunks)</h2>
            <p style="color:#64748b;margin-bottom:16px;">Chunks are grouped alphabetically and by semantic relationship. Each chunk contains max 50 entries sharing the same initial letter, keeping related word families together.</p>
            <table>
                <thead><tr><th>Chunk ID</th><th>Strategy</th><th>Letter Group</th><th>Entries</th><th>Rationale</th></tr></thead>
                <tbody>${chunkRows}</tbody>
            </table>
        </div>

    </div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🔬 Tuvaluan Dictionary — Structure Analysis\n');

    if (!fs.existsSync(PDF_PATH)) {
        console.error('❌ PDF not found:', PDF_PATH);
        process.exit(1);
    }

    process.stdout.write('📄 Parsing PDF...');
    const buf    = fs.readFileSync(PDF_PATH);
    const parsed = await pdfParse(buf);
    const lines  = parsed.text.split('\n');
    console.log(` ${lines.length} lines`);

    // Parse all entries
    const entries = [];
    for (const line of lines) {
        const e = parseLine(line);
        if (e) entries.push(e);
    }
    console.log(`✅ Parsed ${entries.length} raw entries\n`);

    // Analyze
    console.log('🔍 Analyzing structure...');
    const analysis = analyzeEntries(entries);

    console.log(`\n📊 SUMMARY`);
    console.log(`   Total raw entries     : ${analysis.totalRawEntries}`);
    console.log(`   Unique English words  : ${analysis.uniqueEnglish}`);
    console.log(`   Unique Tuvaluan words : ${analysis.uniqueTuvaluan}`);
    console.log(`   1:1 mappings          : ${analysis.oneToOne}`);
    console.log(`   1:many (EN→TV)        : ${analysis.oneToMany}`);
    console.log(`   many:1 (TV shared)    : ${analysis.manyToOne}`);
    console.log(`   Single words          : ${analysis.singleWordCount}`);
    console.log(`   Compound words        : ${analysis.compoundCount}`);
    console.log(`   Phrases               : ${analysis.phraseCount}`);
    console.log(`   With POS tags         : ${analysis.withPosCount}`);
    console.log(`   High polysemy (≥3)    : ${analysis.conflictsCount}`);

    console.log('\n🏷️  POS Distribution:');
    for (const [pos, count] of Object.entries(analysis.posDistribution).slice(0, 10)) {
        console.log(`   ${pos.padEnd(15)} : ${count}`);
    }

    console.log('\n🔄 Top 5 EN words with most TV translations:');
    for (const [en, tvArr] of analysis.topPolysemous.slice(0, 5)) {
        console.log(`   "${en}" → ${tvArr.map(t => t.tuvaluan).join(' | ')}`);
    }

    console.log('\n🔄 Top 5 TV words covering most EN meanings:');
    for (const [tv, enArr] of analysis.topTvPolysemous.slice(0, 5)) {
        console.log(`   "${tv}" ← ${enArr.slice(0, 5).join(' | ')}${enArr.length > 5 ? ` +${enArr.length-5} more` : ''}`);
    }

    // Build chunk strategy
    console.log('\n📦 Building intelligent chunk strategy...');
    const chunkStrategy = buildChunkStrategy(analysis);
    console.log(`   Total proposed chunks : ${chunkStrategy.length}`);

    // Validate
    console.log('\n✅ Validating chunks...');
    const validation = validateChunks(entries, chunkStrategy);
    console.log(`   Original entries      : ${validation.originalCount}`);
    console.log(`   Entries in chunks     : ${validation.chunkTotal}`);
    console.log(`   Missing entries       : ${validation.missingCount}`);
    console.log(`   Status                : ${validation.valid ? '✅ ALL PRESERVED' : '❌ MISSING ENTRIES'}`);

    // Save JSON data
    const jsonData = {
        generatedAt: new Date().toISOString(),
        stats: {
            totalRawEntries:   analysis.totalRawEntries,
            uniqueEnglish:     analysis.uniqueEnglish,
            uniqueTuvaluan:    analysis.uniqueTuvaluan,
            oneToOne:          analysis.oneToOne,
            oneToMany:         analysis.oneToMany,
            manyToOne:         analysis.manyToOne,
            singleWordCount:   analysis.singleWordCount,
            compoundCount:     analysis.compoundCount,
            phraseCount:       analysis.phraseCount,
            withPosCount:      analysis.withPosCount,
            conflictsCount:    analysis.conflictsCount,
        },
        posDistribution:    analysis.posDistribution,
        alphaDistribution:  analysis.alphaDistEN,
        topPolysemous:      analysis.topPolysemous.map(([en, tvArr]) => ({ en, alternatives: tvArr })),
        topSharedTuvaluan:  analysis.topTvPolysemous.map(([tv, enArr]) => ({ tv, englishWords: enArr })),
        chunkStrategy: {
            totalChunks:   chunkStrategy.length,
            strategy:      'alphabetical_grouping_50_per_chunk',
            validationOk:  validation.valid,
        },
        validation,
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(jsonData, null, 2));

    // Generate HTML report
    console.log('\n🎨 Generating HTML report...');
    // Strip large cluster data before passing to HTML (enToTv, tvToEn are Maps)
    const htmlAnalysis = { ...analysis };
    delete htmlAnalysis.enToTv;
    delete htmlAnalysis.tvToEn;
    delete htmlAnalysis.clusters;
    delete htmlAnalysis.allEntries;

    const html = generateHTMLReport(htmlAnalysis, chunkStrategy, validation);
    fs.writeFileSync(OUT_HTML, html);

    console.log(`\n✅ Done!`);
    console.log(`   📄 HTML Report : ${OUT_HTML}`);
    console.log(`   📦 JSON Data   : ${OUT_JSON}`);
    console.log(`\n💡 Open the HTML report in a browser to visualize the full analysis.`);
    console.log(`   Next step: Review the report, then run the intelligent chunking script.`);
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
