import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
import { fetchThemeFromServer, resetTheme } from './themeSlice';
import toast from 'react-hot-toast';

export const fetchUser = createAsyncThunk(
    'auth/fetchUser',
    async (_, { dispatch, rejectWithValue }) => {
        try {
            const { data } = await api.get('/api/user/data');
            if (data.success) {
                dispatch(fetchThemeFromServer());
                // Dynamically import to avoid circular dependency
                const { fetchChats } = await import('./chatSlice');
                dispatch(fetchChats());
                return data.user;
            } else {
                return rejectWithValue(data.message || 'Failed to load user data');
            }
        } catch (error) {
            // Network offline
            if (!error.response) {
                return rejectWithValue('No internet connection. Please check your network.');
            }
            const status = error.response?.status;
            if (status === 401) {
                return rejectWithValue('Session expired. Please log in again.');
            }
            if (status >= 500) {
                return rejectWithValue('Server error. Please try again later.');
            }
            return rejectWithValue(error.response?.data?.message || error.message || 'Failed to load user data');
        }
    }
);

const authSlice = createSlice({
    name: 'auth',
    initialState: {
        user: null,
        token: localStorage.getItem('token') || null,
        loadingUser: false,
        error: null,
        isInitialLoad: true,  // true only on first page load with an existing token
    },
    reducers: {
        setToken: (state, action) => {
            state.token = action.payload;
            // Manual login — never show the full-page loader for this transition.
            // The Login page has its own button spinner.
            state.isInitialLoad = false;
            if (action.payload) {
                localStorage.setItem('token', action.payload);
            } else {
                localStorage.removeItem('token');
                state.user = null;
            }
        },
        logoutUser: (state) => {
            state.token = null;
            state.user = null;
            state.isInitialLoad = false;
            // Clear ALL localStorage keys for this app — ensures no stale data
            // from the previous user is visible to the next user on this device.
            localStorage.clear();
        },
        // Instantly deduct credits locally after a message — avoids re-fetching
        // the full user profile (which would cause loadingUser + page blink).
        decrementCredits: (state, action) => {
            if (state.user) {
                state.user.credits = Math.max(0, (state.user.credits || 0) - action.payload);
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchUser.pending, (state) => {
                state.loadingUser = true;
                state.error = null;
            })
            .addCase(fetchUser.fulfilled, (state, action) => {
                state.loadingUser = false;
                state.isInitialLoad = false;
                state.user = action.payload;
            })
            .addCase(fetchUser.rejected, (state, action) => {
                state.loadingUser = false;
                state.isInitialLoad = false;
                state.error = action.payload;
                // Auth failed — clear everything so user is shown the Login screen
                state.token = null;
                state.user = null;
                localStorage.clear();
                // Only show toast for non-401 errors (401 = expected session expiry)
                // Avoid toasting on initial silent auth-check failures
                if (action.payload && action.payload !== 'Session expired. Please log in again.') {
                    toast.error(action.payload, { id: 'auth-fetch-error', duration: 5000 });
                } else if (action.payload === 'Session expired. Please log in again.') {
                    toast.error('Session expired. Please log in again.', { id: 'session-expired' });
                }
            });
    },
});

export const { setToken, logoutUser, decrementCredits } = authSlice.actions;

export const selectUser = (state) => state.auth.user;
export const selectToken = (state) => state.auth.token;
export const selectLoadingUser = (state) => state.auth.loadingUser;

export default authSlice.reducer;
