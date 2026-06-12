/**
 * Level 5 — Context Builder
 *
 * Aggregates outputs from all upstream levels into a single structured
 * context object. This is passed to the ReconstructionEngine (Level 6)
 * instead of a raw text dump, enabling cleaner, more accurate prompts.
 *
 * Also computes evidenceLevel: 'STRONG' | 'MODERATE' | 'WEAK'
 * which is used by the ConfidenceScorer and drives the prompt tone.
 */

/**
 * @param {object} params
 * @param {string}  params.text           - Original user input
 * @param {string}  params.direction      - 'tv_to_en' | 'en_to_tv'
 * @param {object|null} params.phraseMatch  - From Level 2
 * @param {Array}   params.ragChunks      - From Level 3 (bilingual)
 * @param {Array}   params.dictEntries    - From Level 4 (dictionary)
 * @param {Array}   params.relatedPairs   - From PhrasePair context fetch
 * @returns {object} Structured context
 */
export function buildContext({ text, direction, phraseMatch, ragChunks, dictEntries, relatedPairs }) {
    const isToEnglish = direction === 'tv_to_en';
    const topRagScore = ragChunks.length > 0 ? ragChunks[0].hybridScore || 0 : 0;
    const hasDictEvidence = dictEntries.length > 0;
    const hasPhraseMatch = phraseMatch !== null;
    const hasRagEvidence = topRagScore >= 0.60;

    // Compute evidence level
    let evidenceLevel;
    if (hasPhraseMatch && phraseMatch.confidence >= 0.90) {
        evidenceLevel = 'STRONG';
    } else if (hasRagEvidence && hasDictEvidence) {
        evidenceLevel = 'STRONG';
    } else if (hasRagEvidence || (hasDictEvidence && hasPhraseMatch)) {
        evidenceLevel = 'MODERATE';
    } else {
        evidenceLevel = 'WEAK';
    }

    // Build structured context
    return {
        // Meta
        inputText: text,
        direction,
        isToEnglish,
        targetLanguage: isToEnglish ? 'English' : 'Tuvaluan (Nanumea dialect)',
        evidenceLevel,
        topRagScore,

        // Level 2 — best phrase match (if any)
        phraseMatch: phraseMatch ? {
            input: text,
            output: phraseMatch.text,
            confidence: phraseMatch.confidence,
            source: phraseMatch.source,
            type: phraseMatch.type,
        } : null,

        // Level 3 — top 5 bilingual chunks (tv + en together)
        bilingualChunks: ragChunks.map(c => ({
            tvText: c.tvText,
            enText: c.enText,
            chapter: c.chapterId || c.source,
            score: Math.round((c.hybridScore || 0) * 100) / 100,
        })),

        // Level 4 — dictionary definitions
        dictionaryDefinitions: dictEntries.map(e => ({
            headword: e.headword,
            definition: e.definition,
            partOfSpeech: e.partOfSpeech || null,
            examples: e.examples || null,
            score: Math.round((e.score || 0) * 100) / 100,
        })),

        // Related phrase pairs for vocabulary reference in prompt
        relatedPairs: (relatedPairs || []).map(p => ({
            en: p.english,
            tv: p.tuvaluan,
        })),
    };
}
