import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { assets } from '../assets/assets'
import api from '../services/api'
import { useDispatch } from 'react-redux'
import { setToken, fetchUser } from '../redux/slices/authSlice'

// ─── Validation helpers (mirror server Zod schema) ───────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UPPERCASE_RE = /[A-Z]/
const DIGIT_RE = /[0-9]/

const validate = (state, name, email, password) => {
    const errors = {}

    if (state === 'register') {
        if (!name.trim()) {
            errors.name = 'Name is required'
        } else if (name.trim().length < 2) {
            errors.name = 'Name must be at least 2 characters'
        } else if (name.trim().length > 50) {
            errors.name = 'Name must be at most 50 characters'
        }
    }

    if (!email.trim()) {
        errors.email = 'Email is required'
    } else if (!EMAIL_RE.test(email)) {
        errors.email = 'Invalid email format'
    }

    if (!password) {
        errors.password = 'Password is required'
    } else if (state === 'register') {
        if (password.length < 8) {
            errors.password = 'Password must be at least 8 characters'
        } else if (!UPPERCASE_RE.test(password)) {
            errors.password = 'Must contain at least one uppercase letter'
        } else if (!DIGIT_RE.test(password)) {
            errors.password = 'Must contain at least one number'
        }
    }

    return errors
}

// ─── Password strength indicator ─────────────────────────────────────────────
const getPasswordStrength = (password) => {
    if (!password) return { score: 0, label: '', color: '' }
    let score = 0
    if (password.length >= 8) score++
    if (UPPERCASE_RE.test(password)) score++
    if (DIGIT_RE.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++

    if (score <= 1) return { score, label: 'Weak', color: '#ef4444' }
    if (score === 2) return { score, label: 'Fair', color: '#f59e0b' }
    if (score === 3) return { score, label: 'Good', color: '#8b5cf6' }
    return { score, label: 'Strong', color: '#10b981' }
}

// ─── Spinner component ────────────────────────────────────────────────────────
const Spinner = () => (
    <svg
        className="animate-spin h-4 w-4 text-white"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
    >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
)

const Login = () => {
    const dispatch = useDispatch()
    const [state, setState] = useState('login')
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [touched, setTouched] = useState({ name: false, email: false, password: false })
    const [fieldErrors, setFieldErrors] = useState({})

    const strength = getPasswordStrength(password)

    // Mark field as touched on blur → show inline error
    const handleBlur = (field) => {
        setTouched(prev => ({ ...prev, [field]: true }))
        const errs = validate(state, name, email, password)
        setFieldErrors(errs)
    }

    const switchState = (newState) => {
        setState(newState)
        setFieldErrors({})
        setTouched({ name: false, email: false, password: false })
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        // Prevent double-submit while request is in-flight
        if (loading) return

        // Touch all fields to surface errors
        setTouched({ name: true, email: true, password: true })

        const errs = validate(state, name, email, password)
        setFieldErrors(errs)

        if (Object.keys(errs).length > 0) {
            toast.error('Please fix the errors below', { id: 'validation' })
            return
        }

        setLoading(true)
        const url = state === 'login' ? '/api/user/login' : '/api/user/register'

        try {
            const { data } = await api.post(url, { name: name.trim(), email: email.trim().toLowerCase(), password })

            if (data.success) {
                dispatch(setToken(data.token))
                dispatch(fetchUser())
                toast.success(
                    state === 'login' ? 'Welcome back! 👋' : 'Account created successfully 🎉',
                    { id: 'auth-success', duration: 3000 }
                )
            } else {
                toast.error(data.message || 'Something went wrong', { id: 'auth-error' })
            }
        } catch (error) {
            // Extract the most useful message from the error response
            let msg = 'Network error. Please check your connection and try again.'
            if (error.response?.data) {
                const { message, errors } = error.response.data
                if (errors && typeof errors === 'object') {
                    // Zod field-level validation errors from server
                    msg = Object.values(errors).flat().filter(Boolean).join('. ')
                } else if (message) {
                    msg = message
                }
            } else if (error.message) {
                msg = error.message
            }
            toast.error(msg, { id: 'auth-error' })
        } finally {
            setLoading(false)
        }
    }

    const inputClass = (field) =>
        `border rounded-md w-full p-2.5 mt-1 bg-white/5 text-white placeholder:text-gray-600 transition-all focus:bg-white/10 outline-none ${touched[field] && fieldErrors[field]
            ? 'border-red-500 focus:ring-1 focus:ring-red-500'
            : 'border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50'
        }`

    return (
        <div className="flex flex-col md:flex-row items-center justify-center gap-12 md:gap-16 max-w-4xl w-full px-6 py-8 animate-fade-in">

            {/* ── Branding ── */}
            <div className="flex flex-col items-center md:items-start text-center md:text-left text-white max-w-sm">
                <img src={assets.logo_te_tuvalu} alt="Te Tuvalu Logo" className="w-full max-w-56 sm:max-w-64" />
                <p className="mt-5 text-2xl sm:text-4xl font-bold leading-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                    Translate both ways.
                </p>
                <p className="mt-3 text-sm text-gray-400">
                    Seamless AI-powered translation between Te Tuvalu and English.
                </p>
            </div>

            {/* ── Form Card ── */}
            <form
                id="auth-form"
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-4 items-start p-8 py-10 w-full sm:w-[380px] text-gray-500 rounded-xl shadow-2xl border border-white/10 bg-[#141214]/60 backdrop-blur-xl"
            >
                {/* Tab Switcher */}
                {/* <div className="flex w-full rounded-lg bg-white/5 border border-white/10 p-1 gap-1 mb-1">
                    <button
                        type="button"
                        id="tab-login"
                        onClick={() => switchState('login')}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                            state === 'login'
                                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        id="tab-signup"
                        onClick={() => switchState('register')}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                            state === 'register'
                                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        Sign Up
                    </button>
                </div> */}

                {/* Name field (register only) */}
                {state === 'register' && (
                    <div className="w-full">
                        <label htmlFor="auth-name" className="text-sm text-gray-400">
                            Full Name
                        </label>
                        <input
                            id="auth-name"
                            type="text"
                            autoComplete="name"
                            placeholder="John Doe"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onBlur={() => handleBlur('name')}
                            className={inputClass('name')}
                        />
                        {touched.name && fieldErrors.name && (
                            <p role="alert" className="mt-1 text-xs text-red-400 flex items-center gap-1">
                                <span>⚠</span> {fieldErrors.name}
                            </p>
                        )}
                    </div>
                )}

                {/* Email field */}
                <div className="w-full">
                    <label htmlFor="auth-email" className="text-sm text-gray-400">
                        Email address
                    </label>
                    <input
                        id="auth-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => handleBlur('email')}
                        className={inputClass('email')}
                    />
                    {touched.email && fieldErrors.email && (
                        <p role="alert" className="mt-1 text-xs text-red-400 flex items-center gap-1">
                            <span>⚠</span> {fieldErrors.email}
                        </p>
                    )}
                </div>

                {/* Password field */}
                <div className="w-full">
                    <label htmlFor="auth-password" className="text-sm text-gray-400">
                        Password
                    </label>
                    <div className="relative">
                        <input
                            id="auth-password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete={state === 'login' ? 'current-password' : 'new-password'}
                            placeholder={state === 'register' ? 'Min 8 chars, 1 uppercase, 1 number' : '••••••••'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onBlur={() => handleBlur('password')}
                            className={`${inputClass('password')} pr-10`}
                        />
                        <button
                            type="button"
                            id="toggle-password-visibility"
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Password strength bar (register only) */}
                    {state === 'register' && password && (
                        <div className="mt-2">
                            <div className="flex gap-1 h-1">
                                {[1, 2, 3, 4].map(i => (
                                    <div
                                        key={i}
                                        className="flex-1 rounded-full transition-all duration-300"
                                        style={{
                                            backgroundColor: i <= strength.score ? strength.color : 'rgba(255,255,255,0.1)'
                                        }}
                                    />
                                ))}
                            </div>
                            <p className="text-xs mt-1 transition-colors" style={{ color: strength.color }}>
                                {strength.label}
                            </p>
                        </div>
                    )}

                    {touched.password && fieldErrors.password && (
                        <p role="alert" className="mt-1 text-xs text-red-400 flex items-center gap-1">
                            <span>⚠</span> {fieldErrors.password}
                        </p>
                    )}
                </div>

                {/* Submit button */}
                <button
                    id="auth-submit-btn"
                    type="submit"
                    disabled={loading}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all text-white w-full py-3 mt-2 rounded-md font-medium cursor-pointer shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
                >
                    {loading && <Spinner />}
                    {loading
                        ? state === 'login' ? 'Signing in…' : 'Creating account…'
                        : state === 'login' ? 'Sign In' : 'Create Account'
                    }
                </button>

                {/* Switch mode link */}
                <p className="text-sm text-gray-400 text-center w-full">
                    {state === 'register' ? (
                        <>Already have an account?{' '}
                            <button
                                type="button"
                                id="switch-to-login"
                                onClick={() => switchState('login')}
                                className="text-purple-400 cursor-pointer hover:underline transition-all bg-transparent border-0 p-0"
                            >
                                Sign in
                            </button>
                        </>
                    ) : (
                        <>Don&apos;t have an account?{' '}
                            <button
                                type="button"
                                id="switch-to-register"
                                onClick={() => switchState('register')}
                                className="text-purple-400 cursor-pointer hover:underline transition-all bg-transparent border-0 p-0"
                            >
                                Sign up for free
                            </button>
                        </>
                    )}
                </p>
            </form>
        </div>
    )
}

export default Login
