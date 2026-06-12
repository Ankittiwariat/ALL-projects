import mongoose from 'mongoose';

const phrasePairSchema = new mongoose.Schema(
    {
        english:      { type: String, required: true },
        tuvaluan:     { type: String, required: true },
        normalizedEn: { type: String, required: true, index: true },
        normalizedTv: { type: String, required: true, index: true },
        domain: {
            type:    String,
            enum:    ['general', 'family', 'sports', 'music', 'health', 'love', 'business', 'practice'],
            default: 'general',
            index:   true,
        },
        source: { type: String, required: true, index: true },
        confidence: { type: Number, default: 1.0, min: 0, max: 1 },
        usageCount: { type: Number, default: 0 },
        verified: { type: Boolean, default: false },
    },
    { timestamps: true }
);

phrasePairSchema.index({ normalizedEn: 1, source: 1 }, { unique: true });

const PhrasePair = mongoose.model('PhrasePair', phrasePairSchema);
export default PhrasePair;
