/**
 * Level 6.5 — Output Validator
 *
 * Zero-cost, zero-latency validation using regex and rule-based checks.
 * Detects language mixing, empty outputs, and length anomalies.
 *
 * If invalid, the controller triggers one regeneration before giving up.
 */

// High-frequency English stop words — if too many appear in a TV output, it's mixed
const EN_COMMON = /\b(the|is|was|were|of|and|are|this|that|into|from|with|they|have|been|will|would|should|could|their|there|where|which|about|after|before|during)\b/gi;

// Tuvaluan signature words — if too many appear in an EN output, it's mixed  
const TV_COMMON = /\b(ko|koa|mo|tino|fenua|fale|loto|hoki|pelā|pela|ailoa|mafai|konei|tenei|tatou|latou|kolā|kola|fakatahi|fakamatala)\b/gi;

/**
 * @param {string} output        - The AI-generated translation
 * @param {string} direction     - 'tv_to_en' | 'en_to_tv'
 * @param {string} originalInput - Used for length ratio check
 * @returns {{ valid: boolean, reason: string|null, warnings: string[] }}
 */
export function validateOutput(output, direction, originalInput) {
    const warnings = [];

    // ── Rule 1: Empty output ─────────────────────────────────────────────────
    if (!output || output.trim().length === 0) {
        return { valid: false, reason: 'empty_output', warnings };
    }

    const text = output.trim();

    // ── Rule 2: Language Mixing Detection ────────────────────────────────────
    const wordCount = text.split(/\s+/).length;

    if (direction === 'en_to_tv') {
        // Output should be Tuvaluan — check for too many English words
        const enMatches = (text.match(EN_COMMON) || []).length;
        const enRatio = enMatches / wordCount;
        if (enRatio > 0.25) {
            warnings.push(`language_mixing: ${Math.round(enRatio * 100)}% English words in TV output`);
            if (enRatio > 0.45) {
                return { valid: false, reason: 'language_mismatch_en_in_tv', warnings };
            }
        }
    } else if (direction === 'tv_to_en') {
        // Output should be English — check for too many Tuvaluan signature words
        const tvMatches = (text.match(TV_COMMON) || []).length;
        const tvRatio = tvMatches / wordCount;
        if (tvRatio > 0.20) {
            warnings.push(`language_mixing: ${Math.round(tvRatio * 100)}% Tuvaluan words in EN output`);
            if (tvRatio > 0.40) {
                return { valid: false, reason: 'language_mismatch_tv_in_en', warnings };
            }
        }
    }

    // ── Rule 3: Length Sanity Check ──────────────────────────────────────────
    if (originalInput) {
        const inputLen = originalInput.trim().split(/\s+/).length;
        const outputLen = text.split(/\s+/).length;
        const ratio = outputLen / inputLen;

        if (ratio < 0.15) {
            warnings.push(`length_anomaly: output is only ${Math.round(ratio * 100)}% of input length`);
            return { valid: false, reason: 'output_too_short', warnings };
        }
        if (ratio > 4.0) {
            warnings.push(`length_anomaly: output is ${Math.round(ratio * 100)}% of input length`);
            // Don't fail on long output — it may be a valid expansion — just warn
        }
    }

    // ── Rule 4: Obvious AI refusal / meta-commentary ─────────────────────────
    const refusalPatterns = [
        /^i (cannot|can't|am unable|don't|do not)/i,
        /^as an ai/i,
        /^i'm sorry/i,
        /^translation:/i,
        /^here is the translation/i,
    ];
    for (const pattern of refusalPatterns) {
        if (pattern.test(text)) {
            return { valid: false, reason: 'ai_refusal_or_meta_comment', warnings };
        }
    }

    return { valid: true, reason: null, warnings };
}
