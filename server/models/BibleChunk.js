import mongoose from 'mongoose';

/**
 * BibleChunk — dedicated model for the Tuvaluan Bible.
 *
 * Kept completely separate from DocumentChunk (chapter translations)
 * so Bible content never pollutes translation retrieval results.
 *
 * Atlas Vector Search index must be created manually:
 *   Collection : bible_chunks
 *   Index name : bible_vector_index
 *   Field path : embedding  (vector, cosine, 1536 dims)
 */
const bibleChunkSchema = new mongoose.Schema(
    {
        // Raw text of this verse-range chunk
        text: { type: String, required: true },

        // OpenAI text-embedding-3-small output (1536 floats)
        embedding: { type: [Number], required: true },

        // Always 'tv' — Tuvaluan-only Bible
        language: { type: String, default: 'tv', enum: ['tv'], required: true },

        // Book name in Tuvaluan, e.g. "Kenisi", "Ekoto", "Saame"
        book: { type: String, required: true, index: true },

        // Book number (1–66) for ordering
        bookNumber: { type: Number, required: true, index: true },

        // Chapter number within the book
        chapter: { type: Number, required: true, index: true },

        // Verse range for this chunk, e.g. "1-10"
        verseRange: { type: String, default: null },

        // Start verse number
        verseStart: { type: Number, default: null },

        // End verse number
        verseEnd: { type: Number, default: null },

        // Zero-based chunk index within this book+chapter
        chunkIndex: { type: Number, required: true },
    },
    { timestamps: true }
);

// Unique constraint
bibleChunkSchema.index({ book: 1, chapter: 1, chunkIndex: 1 }, { unique: true });

const BibleChunk = mongoose.model('BibleChunk', bibleChunkSchema);
export default BibleChunk;
