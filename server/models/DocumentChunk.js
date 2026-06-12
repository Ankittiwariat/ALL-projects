import mongoose from 'mongoose';

/**
 * DocumentChunk — stores paragraph-level text chunks from bilingual chapter PDFs.
 *
 * Design v2 (redesigned):
 *  - Paragraph-level chunking (40–200 words) replaces 500-word sliding window
 *  - Explicit EN↔TV pairing via documentId / pairedDocumentId
 *  - Bilingual pair chunks (language='bilingual') embed both languages together
 *    so queries in either language retrieve the same chunk with high confidence
 *  - Rich metadata enables precise cross-language filtering without guessing
 */
const documentChunkSchema = new mongoose.Schema(
    {
        // Raw text of this chunk
        text: { type: String, required: true },

        // OpenAI text-embedding-3-small output (1536 floats)
        embedding: { type: [Number], required: true },

        // Original filename
        source: { type: String, required: true, index: true },

        // Language of this chunk: 'en' | 'tv' | 'bilingual'
        language: {
            type:     String,
            enum:     ['en', 'tv', 'bilingual'],
            required: true,
            index:    true,
        },

        // Human-readable chapter label, e.g. "Chapter 10"
        chapterId: { type: String, default: null, index: true },

        // Human-readable chapter title in both languages,
        // e.g. "Fish and Fishing / Ika mo te Faiva"
        chapterTitle: { type: String, default: null },

        // Unique identifier for THIS document, e.g. "chapter_10_en"
        documentId: { type: String, default: null, index: true },

        // Identifier of the paired language document, e.g. "chapter_10_tv"
        pairedDocumentId: { type: String, default: null, index: true },

        // Zero-based paragraph position within this document
        chunkIndex: { type: Number, required: true },

        // Total paragraphs in this document (for proportional alignment)
        totalChunks: { type: Number, default: null },

        // Direct reference to the paired bilingual chunk (set after both sides are inserted)
        pairedChunkId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    },
    { timestamps: true }
);

// Unique constraint — prevents duplicate ingestion
documentChunkSchema.index({ source: 1, chunkIndex: 1 }, { unique: true });

// Compound index for fast cross-language lookup
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 });
documentChunkSchema.index({ pairedDocumentId: 1, chunkIndex: 1 });

const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
export default DocumentChunk;
