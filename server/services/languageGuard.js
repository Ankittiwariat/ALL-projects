/**
 * Level 0 — Language Guard Service
 *
 * Detects the language of the input using a curated Tuvaluan signature
 * word list. If the detected language conflicts with the selected direction
 * toggle, it returns a mismatch warning so the client can alert the user.
 *
 * Cost: Zero — pure in-memory operation, < 1ms
 */

// Curated high-frequency Tuvaluan words unlikely to appear in English text
const TV_SIGNATURES = new Set([
    'ko', 'te', 'koa', 'mo', 'tino', 'fenua', 'fale', 'ika', 'matagi', 'loto',
    'muna', 'kāiga', 'kaiga', 'āvaga', 'avaga', 'tamaliki', 'pulefenua', 'ai',
    'hoki', 'pelā', 'pela', 'tāua', 'taua', 'laukele', 'faifaiga', 'mālō', 'malo',
    'tulāfono', 'tulafono', 'kautama', 'fakamatala', 'mafai', 'tatou', 'lātou',
    'latou', 'kolā', 'kola', 'ailoa', 'atu', 'mai', 'ifo', 'atu', 'fakatahi',
    'kaupule', 'falekaupule', 'atua', 'filemu', 'olaga', 'uiga', 'fakaalofa',
    'talofa', 'fakafetai', 'fakamanuia', 'manaia', 'fakaoti', 'konei', 'tenei',
    'tenā', 'tena', 'aliki', 'matua', 'tamana', 'tinana', 'tuagane', 'tuafafine',
    'fano', 'sau', 'nofo', 'galue', 'kai', 'inu', 'moe', 'fai'
]);

/**
 * @param {string} text - Raw user input
 * @param {string} direction - 'tv_to_en' | 'en_to_tv'
 * @returns {{ detectedLang: 'tv'|'en'|'mixed', confidence: number, mismatch: boolean }}
 */
export function checkLanguageGuard(text, direction) {
    if (!text || text.trim().length === 0) {
        return { detectedLang: 'unknown', confidence: 0, mismatch: false };
    }

    const tokens = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    if (tokens.length === 0) {
        return { detectedLang: 'unknown', confidence: 0, mismatch: false };
    }

    const tvHits = tokens.filter(t => TV_SIGNATURES.has(t)).length;
    const tvRatio = tvHits / tokens.length;

    let detectedLang;
    let confidence;

    if (tvRatio >= 0.35) {
        detectedLang = 'tv';
        confidence = Math.round(tvRatio * 100);
    } else if (tvRatio >= 0.15) {
        detectedLang = 'mixed';
        confidence = Math.round(tvRatio * 100);
    } else {
        detectedLang = 'en';
        confidence = Math.round((1 - tvRatio) * 100);
    }

    // Mismatch: user says en_to_tv but input is Tuvaluan, or vice versa
    const mismatch =
        (direction === 'en_to_tv' && detectedLang === 'tv') ||
        (direction === 'tv_to_en' && detectedLang === 'en');

    return { detectedLang, confidence, mismatch };
}
