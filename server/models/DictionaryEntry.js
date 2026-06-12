import mongoose from 'mongoose';

/**
 * DictionaryEntry — stores structured Tuvaluan dictionary entries.
 *
 * Each document represents one dictionary word/phrase with its definition,
 * part of speech, example sentences, and a semantic embedding for vector search.
 *
 * Atlas Vector Search index must be created manually:
 *   Collection : dictionaryentries
 *   Index name : dictionary_vector_index
 *   Field path : embedding  (vector, cosine, 1536 dims)
 *
 * Used in Translation Level 2.5: when chapter RAG score < 0.75,
 * each meaningful word in the input is looked up here to gather
 * real dictionary definitions before sending to GPT.
 */
const dictionaryEntrySchema = new mongoose.Schema(
    {
        // The word or phrase being defined (Tuvaluan or English)
        headword: { type: String, required: true, index: true },

        // Which language the headword is written in
        language: {
            type:     String,
            enum:     ['tv', 'en', 'both'],
            required: true,
            index:    true,
        },

        // Full English definition/meaning of the headword
        definition: { type: String, required: true },

        // Grammatical category: noun, verb, adj, adv, phrase, etc.
        partOfSpeech: { type: String, default: null },

        // Example sentences (optional, as found in the dictionary)
        examples: { type: String, default: null },

        // Combined text used for semantic embedding:
        // "headword (partOfSpeech) — definition. Example: examples"
        entryText: { type: String, required: true },

        // OpenAI text-embedding-3-small output (1536 floats)
        embedding: { type: [Number], required: true },

        // Position of this entry within the ingestion run (for upsert key)
        chunkIndex: { type: Number, required: true },

        // Source filename — always 'tuvaluan-dictionary.pdf'
        source: { type: String, required: true, index: true },
    },
    { timestamps: true }
);

// Unique constraint — prevents duplicate ingestion
dictionaryEntrySchema.index({ source: 1, chunkIndex: 1 }, { unique: true });

// Compound index for fast headword lookups
dictionaryEntrySchema.index({ headword: 1, language: 1 });

const DictionaryEntry = mongoose.model('DictionaryEntry', dictionaryEntrySchema);
export default DictionaryEntry;
