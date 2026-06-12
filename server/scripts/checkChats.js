import 'dotenv/config';
import mongoose from 'mongoose';
import Chat from '../models/Chat.js';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI + '/te_tuvalu_gpt');
    const latestChat = await Chat.findOne().sort({ updatedAt: -1 }).lean();
    if (!latestChat) {
        console.log("No chats found.");
        process.exit(0);
    }
    console.log("Chat name:", latestChat.name);
    for (const msg of latestChat.messages) {
        console.log(`[${msg.role}] [${msg.responseLevel || '-'}] ${msg.content}`);
    }
    process.exit(0);
}
main();
