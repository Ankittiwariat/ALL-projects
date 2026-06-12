import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_SERVER_URL,
});

// Inject token from localStorage on every request automatically
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers['Authorization'] = token;
    }
    return config;
});

// To be called from main.jsx to inject store/actions without circular imports
export const setupInterceptors = (store, logoutUserAction) => {
    api.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response?.status === 401) {
                store.dispatch(logoutUserAction());
            }
            return Promise.reject(error);
        }
    );
};

export default api;
