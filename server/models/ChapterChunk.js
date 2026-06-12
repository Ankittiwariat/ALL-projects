import mongoose from 'mongoose';

const chapterChunkSchema = new mongoose.Schema(
    {
        chapterId:    { type: String, required: true, index: true },
        chapterTitle: { type: String, default: null },
        language:     { type: String, enum: ['en', 'tv'], required: true, index: true },
        chunkIndex:   { type: Number, required: true },
        fullText:     { type: String, required: true },
        snippetText:  { type: String, required: true },
        embedding:    { type: [Number], required: true },
        alignedChunkId:   { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        alignedFullText:  { type: String, default: null },
        alignmentScore:   { type: Number, default: null },
        source: { type: String, required: true, index: true },
    },
    { timestamps: true }
);

chapterChunkSchema.index({ source: 1, chunkIndex: 1 }, { unique: true });
chapterChunkSchema.index({ chapterId: 1, language: 1 });
chapterChunkSchema.index({ chapterId: 1, chunkIndex: 1 });

const ChapterChunk = mongoose.model('ChapterChunk', chapterChunkSchema);
export default ChapterChunk;
