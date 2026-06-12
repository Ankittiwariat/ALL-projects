/**
 * Level 7 — Confidence Scorer
 *
 * Computes a 0–100 confidence score from existing pipeline evidence.
 * Zero API calls — pure computation from the context object.
 *
 * Score breakdown:
 *  - Phrase match quality:        0–40 points
 *  - Top RAG chunk score:         0–30 points
 *  - Dictionary evidence depth:   0–20 points
 *  - Output Validator pass:       0–10 points
 */

/**
 * @param {object} context        - From contextBuilder
 * @param {object} validationResult - From outputValidator
 * @returns {{ score: number, label: 'HIGH'|'MODERATE'|'LOW', breakdown: object }}
 */
export function computeConfidence(context, validationResult) {
    let score = 0;
    const breakdown = {};

    // ── Phrase Match (max 40 points) ─────────────────────────────────────────
    if (context.phraseMatch) {
        const phrasePoints = Math.round(context.phraseMatch.confidence * 40);
        breakdown.phraseMatch = phrasePoints;
        score += phrasePoints;
    } else {
        breakdown.phraseMatch = 0;
    }

    // ── Top RAG Score (max 30 points) ─────────────────────────────────────────
    const topRagScore = context.topRagScore || 0;
    const ragPoints = Math.round(topRagScore * 30);
    breakdown.ragScore = ragPoints;
    score += ragPoints;

    // ── Dictionary Evidence (max 20 points, 3 points per entry, max 7 entries) ─
    const dictPoints = Math.min(context.dictionaryDefinitions.length * 3, 20);
    breakdown.dictionaryEntries = dictPoints;
    score += dictPoints;

    // ── Output Validator (max 10 points) ─────────────────────────────────────
    const validatorPoints = validationResult.valid ? 10 : 0;
    breakdown.outputValid = validatorPoints;
    score += validatorPoints;

    // ── Cap at 100 ────────────────────────────────────────────────────────────
    score = Math.min(score, 100);

    // ── Label ─────────────────────────────────────────────────────────────────
    let label;
    if (score >= 75) label = 'HIGH';
    else if (score >= 45) label = 'MODERATE';
    else label = 'LOW';

    return { score, label, breakdown };
}
