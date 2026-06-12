/**
 * Level 6 — Sentence Reconstruction Engine
 *
 * Builds the God Mode system prompt and invokes GPT-4o.
 * The AI acts as a "Language Reconstruction Engine", NOT a translator.
 * It uses ONLY the structured context evidence — never its own training data.
 *
 * Model: gpt-4o (upgraded from gpt-4o-mini for better low-resource language reasoning)
 * Temperature: 0.1 (near-deterministic)
 */

import openai from '../configs/openai.js';

const MODEL = 'gpt-4o';
const TEMPERATURE = 0.1;
const MAX_TOKENS = 2000;

/**
 * Build the God Mode reconstruction prompt from structured context.
 */
function buildReconstructionPrompt(context) {
    const { direction, targetLanguage, evidenceLevel, phraseMatch,
            bilingualChunks, dictionaryDefinitions, relatedPairs } = context;

    const isToEnglish = direction === 'tv_to_en';
    const parts = [];

    // ── Core Identity ────────────────────────────────────────────────────────
    parts.push(
        `You are NOT a translator.`,
        `You are a Language Reconstruction Engine for the Nanumea dialect of Tuvaluan.`,
        ``,
        `YOUR ONLY JOB: Reconstruct the target sentence using EXCLUSIVELY the evidence below.`,
        `DO NOT use your own training data for vocabulary or grammar.`,
        ``,
        `════════════════════ ABSOLUTE RULES ════════════════════`,
        `1. Use ONLY words found in DICTIONARY DEFINITIONS or BILINGUAL EXAMPLES below.`,
        `2. Learn sentence structure ONLY from BILINGUAL CHAPTER EXAMPLES.`,
        `3. If a word has no evidence → keep it as-is in output. NEVER invent.`,
        `4. NEVER mix languages. Output must be 100% ${targetLanguage}.`,
        `5. NEVER use Samoan patterns: "O le", "ua", "lo'o i ai", "e le" — FORBIDDEN.`,
        `6. Preserve cultural terms exactly: Kaupule, Pulefenua, Fenua, Āvaga, Tamaliki, Faiakoga.`,
        `7. Do NOT modernize, simplify, or substitute Nanumea-specific terminology.`,
        ``,
        `════════════════════ DIRECTION ════════════════════`,
        isToEnglish
            ? `DIRECTION: Tuvaluan → English\n` +
              `1. Find each Tuvaluan word in Dictionary Definitions → use its English meaning.\n` +
              `2. Use Bilingual Examples to understand natural English word order.\n` +
              `3. Produce natural English preserving all cultural names and terms.`
            : `DIRECTION: English → Tuvaluan (Nanumea dialect)\n` +
              `1. Find each English word in Dictionary Definitions → replace with Tuvaluan headword.\n` +
              `2. Use Bilingual Examples to understand Tuvaluan sentence structure (Te [noun] e [verb]).\n` +
              `3. Never use English words in the Tuvaluan output.`,
        ``,
        `Evidence Level: ${evidenceLevel}`,
        `OUTPUT: Return ONLY the final ${targetLanguage} sentence. No labels, no explanation, no commentary.`,
    );

    // ── Phrase Match (highest priority) ──────────────────────────────────────
    if (phraseMatch) {
        parts.push(
            ``,
            `════════════════════ PHRASE MATCH (Highest Priority — use verbatim if applicable) ════════════════════`,
            `Input:  ${phraseMatch.input}`,
            `Output: ${phraseMatch.output}`,
            `Confidence: ${Math.round(phraseMatch.confidence * 100)}%`
        );
    }

    // ── Dictionary Definitions ───────────────────────────────────────────────
    if (dictionaryDefinitions.length > 0) {
        const dictLines = dictionaryDefinitions.map(e => {
            const arrow = isToEnglish ? `→ English: ${e.definition}` : `→ Tuvaluan: ${e.headword}`;
            let line = `  [${e.headword}]`;
            if (e.partOfSpeech) line += ` (${e.partOfSpeech})`;
            line += ` ${arrow}`;
            if (e.examples) line += `\n   Example: ${e.examples}`;
            return line;
        });
        parts.push(
            ``,
            `════════════════════ DICTIONARY DEFINITIONS (Ground truth — use these exact words) ════════════════════`,
            dictLines.join('\n\n'),
            `════════════════════ END DICTIONARY ════════════════════`
        );
    }

    // ── Bilingual Chapter Examples ───────────────────────────────────────────
    if (bilingualChunks.length > 0) {
        const chunkLines = bilingualChunks.map((c, i) => {
            const label = c.chapter ? `[${c.chapter} | score: ${c.score}]` : `[Chunk ${i+1}]`;
            return `${label}\n  Tuvaluan: ${c.tvText}\n  English:  ${c.enText}`;
        });
        parts.push(
            ``,
            `════════════════════ BILINGUAL CHAPTER EXAMPLES (Learn grammar and word order from these) ════════════════════`,
            chunkLines.join('\n\n')
        );
    }

    // ── Related Phrase Pairs (Vocabulary Reference) ──────────────────────────
    if (relatedPairs.length > 0) {
        const pairLines = relatedPairs.map(p => `  EN: ${p.en}\n  TV: ${p.tv}`);
        parts.push(
            ``,
            `════════════════════ PHRASE PAIRS (Additional vocabulary reference) ════════════════════`,
            pairLines.join('\n\n')
        );
    }

    return parts.join('\n');
}

/**
 * Non-streaming: returns the full translated text.
 */
export async function reconstruct(context) {
    const systemPrompt = buildReconstructionPrompt(context);
    const userMsg = `Please reconstruct the following text into ${context.targetLanguage}:\n\n"""\n${context.inputText}\n"""`;

    const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
        ],
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
}

/**
 * Streaming: writes SSE tokens to res and returns accumulated full text.
 */
export async function reconstructStream(context, sendToken) {
    const systemPrompt = buildReconstructionPrompt(context);
    const userMsg = `Please reconstruct the following text into ${context.targetLanguage}:\n\n"""\n${context.inputText}\n"""`;

    const stream = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
        ],
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
    });

    let fullText = '';
    for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
            fullText += token;
            sendToken(token);
        }
    }
    return fullText.trim();
}
