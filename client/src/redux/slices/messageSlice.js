import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
import { updateChatName } from './chatSlice';
import toast from 'react-hot-toast';
import { logoutUser } from './authSlice';

export const sendMessage = createAsyncThunk(
    'message/sendMessage',
    async ({ mode, chatId, prompt, isPublished }, { dispatch, rejectWithValue }) => {
        try {
            const { data } = await api.post(`/api/message/${mode}`, { chatId, prompt, isPublished });
            if (data.success) {
                if (data.chatName) {
                    dispatch(updateChatName({ chatId, name: data.chatName }));
                }
                return data.reply;
            } else {
                return rejectWithValue(data.message || 'Failed to send message');
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message || 'Failed to send message';
            // Only toast if it's not a standard 401 (which is handled by logout)
            if (error.response?.status !== 401) {
                toast.error(msg, { id: 'send-msg-err' });
            }
            return rejectWithValue(msg);
        }
    }
);

const messageSlice = createSlice({
    name: 'message',
    initialState: {
        messages: [],
        loading: false,
        error: null,
    },
    reducers: {
        setMessages: (state, action) => {
            state.messages = action.payload;
        },
        addOptimisticMessage: (state, action) => {
            state.messages.push(action.payload);
        },
        removeLastMessage: (state) => {
            state.messages.pop();
        },
        clearMessages: (state) => {
            state.messages = [];
        },
        // ── Streaming helpers ──────────────────────────────────────────────────
        // 1. Insert a blank AI placeholder to render immediately
        beginStreamingMessage: (state) => {
            state.loading = true;
            state.messages.push({
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isImage: false,
                isStreaming: true,
            });
        },
        // 2. Append each incoming token to the last message
        appendStreamingToken: (state, action) => {
            const last = state.messages[state.messages.length - 1];
            if (last && last.isStreaming) {
                last.content += action.payload;
            }
        },
        // 3. Replace the streaming placeholder with the persisted reply from DB.
        //    If content is null (user stopped mid-stream), preserve accumulated content.
        finalizeStreamingMessage: (state, action) => {
            state.loading = false;
            const last = state.messages[state.messages.length - 1];
            if (last && last.isStreaming) {
                const preservedContent = action.payload.content === null ? last.content : action.payload.content;
                Object.assign(last, action.payload, { content: preservedContent, isStreaming: false });
            }
        },
        // 4. Called on streaming error to clean up
        cancelStreamingMessage: (state) => {
            state.loading = false;
            const last = state.messages[state.messages.length - 1];
            if (last && last.isStreaming) {
                state.messages.pop();
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(sendMessage.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(sendMessage.fulfilled, (state, action) => {
                state.loading = false;
                state.messages.push(action.payload);
            })
            .addCase(sendMessage.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
                // Use a stable id so rapid failures don't stack duplicate toasts
                toast.error(action.payload || 'Failed to send message. Please try again.', { id: 'msg-error' });
                state.messages.pop(); // Remove the optimistic message on failure
            })
            // Reset messages when the user logs out (any code path)
            .addCase(logoutUser, (state) => {
                state.messages = [];
                state.loading = false;
                state.error = null;
            });
    },
});

export const {
    setMessages,
    addOptimisticMessage,
    removeLastMessage,
    clearMessages,
    beginStreamingMessage,
    appendStreamingToken,
    finalizeStreamingMessage,
    cancelStreamingMessage,
} = messageSlice.actions;

export const selectMessages = (state) => state.message.messages;
export const selectMessageLoading = (state) => state.message.loading;

export default messageSlice.reducer;
