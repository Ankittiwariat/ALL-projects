import { createContext, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from 'react-redux';
import { fetchUser, setToken, selectToken } from '../redux/slices/authSlice';

// ─── Context ─────────────────────────────────────────────────────────────────
const AppContext = createContext()

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AppContextProvider = ({ children }) => {
    const navigate = useNavigate()
    const dispatch = useDispatch()
    const token = useSelector(selectToken)
    const isInitialLoad = useSelector(state => state.auth.isInitialLoad)

    // ── Hard page-reload: token exists in localStorage but user not yet fetched ──
    // Do NOT re-fetch on manual login — Login.jsx dispatches fetchUser() itself.
    // isInitialLoad is true ONLY on the very first render with a pre-existing token.
    useEffect(() => {
        if (token && isInitialLoad) {
            dispatch(fetchUser())
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    // Empty deps: intentionally runs once on mount only (hard-reload guard).

    // ─── Context Value ─────────────────────────────────────────────────────────
    const value = {
        navigate,
        setToken: (t) => dispatch(setToken(t)),
    }

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    )
}

export const useAppContext = () => useContext(AppContext)