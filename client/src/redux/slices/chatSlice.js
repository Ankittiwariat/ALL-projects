import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { logoutUser } from './authSlice';

export const fetchChats = createAsyncThunk(
    'chat/fetchChats',
    async (_, { dispatch, rejectWithValue }) => {
        try {
            const { data } = await api.get('/api/chat/get');
            if (data.success) {
                return data.chats;
            } else {
                return rejectWithValue(data.message || 'Failed to load conversations');
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message || 'Failed to load conversations';
            // Only toast if it's not a standard 401 (which is handled by logout)
            if (error.response?.status !== 401) {
                toast.error(msg, { id: 'fetch-chats-err' });
            }
            return rejectWithValue(msg);
        }
    }
);

export const createNewChat = createAsyncThunk(
    'chat/createNewChat',
    async (_, { dispatch, rejectWithValue }) => {
        try {
            const { data } = await api.post('/api/chat/create');
            if (data.success) {
                dispatch(fetchChats());
                return data.chat;
            } else {
                toast.error(data.message || 'Failed to create new chat', { id: 'create-chat-err' });
                return rejectWithValue(data.message);
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message || 'Failed to create new chat';
            toast.error(msg, { id: 'create-chat-err' });
            return rejectWithValue(msg);
        }
    }
);

export const deleteChat = createAsyncThunk(
    'chat/deleteChat',
    async (chatId, { dispatch, rejectWithValue }) => {
        try {
            const { data } = await api.post('/api/chat/delete', { chatId });
            if (data.success) {
                toast.success(data.message || 'Conversation deleted', { id: 'chat-deleted' });
                return chatId;
            } else {
                toast.error(data.message || 'Failed to delete chat', { id: 'chat-delete-err' });
                return rejectWithValue(data.message);
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message || 'Failed to delete chat';
            toast.error(msg, { id: 'chat-delete-err' });
            return rejectWithValue(msg);
        }
    }
);

const chatSlice = createSlice({
    name: 'chat',
    initialState: {
        chats: [],
        selectedChat: null,
        loadingChats: false,
        isDeleting: false,
        error: null,
    },
    reducers: {
        setSelectedChat: (state, action) => {
            state.selectedChat = action.payload;
            if (action.payload) {
                localStorage.setItem('selectedChatId', action.payload._id);
            } else {
                localStorage.removeItem('selectedChatId');
            }
        },
        updateChatName: (state, action) => {
            const { chatId, name } = action.payload;
            const chat = state.chats.find(c => c._id === chatId);
            if (chat) {
                chat.name = name;
            }
            if (state.selectedChat?._id === chatId) {
                state.selectedChat.name = name;
            }
        },
        clearChatState: (state) => {
            state.chats = [];
            state.selectedChat = null;
            localStorage.removeItem('selectedChatId');
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchChats.pending, (state) => {
                state.loadingChats = true;
            })
            .addCase(fetchChats.fulfilled, (state, action) => {
                state.loadingChats = false;
                state.chats = action.payload;
                
                if (action.payload.length > 0) {
                    if (!state.selectedChat) {
                        // Initial load: try to restore from localStorage
                        const savedChatId = localStorage.getItem('selectedChatId');
                        const savedChat = savedChatId ? action.payload.find(c => c._id === savedChatId) : null;
                        state.selectedChat = savedChat || action.payload[0];
                        if (state.selectedChat) {
                            localStorage.setItem('selectedChatId', state.selectedChat._id);
                        }
                    } else {
                        // Chat already selected, ensure it stays in sync with latest fetched data
                        const freshSelectedChat = action.payload.find(c => c._id === state.selectedChat._id);
                        if (freshSelectedChat) {
                            state.selectedChat = freshSelectedChat;
                        } else {
                            // If the chat disappeared (deleted from another tab?), fallback
                            state.selectedChat = action.payload[0];
                            localStorage.setItem('selectedChatId', action.payload[0]._id);
                        }
                    }
                } else {
                    state.selectedChat = null;
                    localStorage.removeItem('selectedChatId');
                }
            })
            .addCase(fetchChats.rejected, (state, action) => {
                state.loadingChats = false;
                state.error = action.payload;
            })
            .addCase(deleteChat.pending, (state) => {
                state.isDeleting = true;
            })
            .addCase(deleteChat.fulfilled, (state, action) => {
                state.isDeleting = false;
                const deletedChatId = action.payload;
                state.chats = state.chats.filter(c => c._id !== deletedChatId);

                // Only touch selectedChat if the deleted one was the active one
                if (state.selectedChat?._id === deletedChatId) {
                    const next = state.chats[0] || null;
                    state.selectedChat = next;
                    if (next) {
                        localStorage.setItem('selectedChatId', next._id);
                    } else {
                        // No chats left — clear the persisted selection so the
                        // ChatBox useEffect fires and clears the message view.
                        localStorage.removeItem('selectedChatId');
                    }
                }
            })
            .addCase(deleteChat.rejected, (state) => {
                state.isDeleting = false;
            })
            .addCase(createNewChat.fulfilled, (state, action) => {
                state.selectedChat = action.payload;
                if (action.payload) {
                    localStorage.setItem('selectedChatId', action.payload._id);
                }
            })
            // Reset all chat state when the user logs out (any code path)
            .addCase(logoutUser, (state) => {
                state.chats = [];
                state.selectedChat = null;
                state.loadingChats = false;
                state.isDeleting = false;
                state.error = null;
                localStorage.removeItem('selectedChatId');
            });
    },
});

export const { setSelectedChat, updateChatName, clearChatState } = chatSlice.actions;

export const selectChats = (state) => state.chat.chats;
export const selectSelectedChat = (state) => state.chat.selectedChat;
export const selectIsDeleting = (state) => state.chat.isDeleting;
export const selectLoadingChats = (state) => state.chat.loadingChats;

export default chatSlice.reducer;
