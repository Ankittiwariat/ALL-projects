import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './slices/themeSlice';
import authReducer from './slices/authSlice';
import chatReducer from './slices/chatSlice';
import messageReducer from './slices/messageSlice';

const store = configureStore({
    reducer: {
        theme: themeReducer,
        auth: authReducer,
        chat: chatReducer,
        message: messageReducer,
    },
    // Suppress serializable check warning for any Date objects in state (if added later)
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredPaths: ['theme'],
            },
        }),
});

export default store;
