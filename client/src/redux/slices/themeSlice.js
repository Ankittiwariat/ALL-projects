import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
import { logoutUser } from './authSlice';

// ─── Async Thunks ────────────────────────────────────────────────────────────

/**
 * Fetches the user's theme from the backend after login.
 * Called as part of the auth initialization flow.
 */
export const fetchThemeFromServer = createAsyncThunk(
    'theme/fetchFromServer',
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await api.get('/api/user/data');
            if (data.success && data.user?.theme) {
                return data.user.theme;
            }
            return 'light'; // first-time user fallback
        } catch (err) {
            return rejectWithValue('light'); // API failure fallback
        }
    }
);

/**
 * Persists the user's chosen theme to the backend.
 * Fire-and-forget optimistic update — does not block the UI.
 */
export const updateThemeToServer = createAsyncThunk(
    'theme/updateToServer',
    async (theme, { rejectWithValue }) => {
        try {
            await api.post('/api/user/theme', { theme });
            return theme;
        } catch (err) {
            return rejectWithValue(theme); // On failure, current state still valid
        }
    }
);

// ─── Slice ───────────────────────────────────────────────────────────────────

const themeSlice = createSlice({
    name: 'theme',
    initialState: {
        theme: 'light',   // Current active theme
        isLoaded: false,  // Blocks UI render until theme is resolved (prevents flicker)
    },
    reducers: {
        /**
         * Directly sets the theme. Used for immediate DOM application.
         */
        setTheme: (state, action) => {
            state.theme = action.payload;
            applyThemeToDOM(action.payload);
        },

        /**
         * Toggles between dark and light — pure synchronous optimistic update.
         * Backend sync is handled separately via updateThemeToServer thunk.
         */
        toggleTheme: (state) => {
            const next = state.theme === 'dark' ? 'light' : 'dark';
            state.theme = next;
            applyThemeToDOM(next);
        },

        /**
         * Resets theme to 'light' on logout. Clears isLoaded so the next
         * user's login triggers a fresh server fetch.
         */
        resetTheme: (state) => {
            state.theme = 'light';
            state.isLoaded = false;
            applyThemeToDOM('light');
        },
    },
    extraReducers: (builder) => {
        builder
            // fetchThemeFromServer — fulfilled
            .addCase(fetchThemeFromServer.fulfilled, (state, action) => {
                state.theme = action.payload;
                state.isLoaded = true;
                applyThemeToDOM(action.payload);
            })
            // fetchThemeFromServer — rejected (API down or network error)
            .addCase(fetchThemeFromServer.rejected, (state, action) => {
                state.theme = action.payload || 'light';
                state.isLoaded = true; // Must still mark loaded to unblock UI
                applyThemeToDOM(state.theme);
            })
            // Reset theme when user logs out (any code path)
            .addCase(logoutUser, (state) => {
                state.theme = 'light';
                state.isLoaded = false;
                applyThemeToDOM('light');
            })
    }
});

// ─── DOM Helper (runs outside React, direct DOM mutation) ────────────────────

/**
 * Single, controlled toggle point for the <html> dark class.
 * Uses classList.toggle for idempotency — calling twice with same value is safe.
 */
function applyThemeToDOM(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const { setTheme, toggleTheme, resetTheme } = themeSlice.actions;

// Memoized selectors to prevent unnecessary re-renders
export const selectTheme = (state) => state.theme.theme;
export const selectThemeIsLoaded = (state) => state.theme.isLoaded;

export default themeSlice.reducer;
