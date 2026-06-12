import React, { useState } from 'react'
import Sidebar from './components/Sidebar'
import { Route, Routes, useLocation } from 'react-router-dom'
import ChatBox from './components/ChatBox'
import Credits from './pages/Credits'
import Community from './pages/Community'
import { assets } from './assets/assets'
import './assets/prism.css'
import Loading from './pages/Loading'
import { useAppContext } from './context/AppContext'
import Login from './pages/Login'
import { Toaster } from 'react-hot-toast'
import { useSelector } from 'react-redux'
import { selectUser } from './redux/slices/authSlice'

const App = () => {

  const { navigate } = useAppContext()
  const user = useSelector(selectUser)
  const token = useSelector(state => state.auth.token)
  const isInitialLoad = useSelector(state => state.auth.isInitialLoad)

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { pathname } = useLocation()

  if (isInitialLoad && token && !user) return <Loading />

  return (
    <>
      <Toaster
        position="top-right"
        reverseOrder={false}
        gutter={10}
        toastOptions={{
          duration: 4000,
          style: {
            background: 'rgba(20, 18, 24, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: '#e2e8f0',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            fontSize: '14px',
            fontFamily: 'Outfit, sans-serif',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            maxWidth: '360px',
            padding: '12px 16px',
          },
          success: {
            iconTheme: { primary: '#8b5cf6', secondary: '#fff' },
            duration: 3000,
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
            duration: 5000,
          },
        }}
      />

      {user ? (
        /*
         * KEY: do NOT use h-screen (= 100vh) — on iOS Safari 100vh includes
         * the browser chrome so bottom elements get hidden. Use app-shell class
         * which uses 100dvh with -webkit-fill-available fallback.
         */
        <div className='dark:bg-gradient-to-b from-[#242124] to-[#000000] dark:text-white app-shell'>
          {/* Mobile Overlay — tap outside sidebar to close */}
          {isMenuOpen && (
            <div
              className='fixed inset-0 z-10 bg-black/40 md:hidden'
              onClick={() => setIsMenuOpen(false)}
            />
          )}

          {/* Hamburger — fixed, always on top, visible when sidebar is closed */}
          {!isMenuOpen && (
            <button
              aria-label="Open sidebar"
              style={{ zIndex: 30 }}
              className='fixed top-4 left-3 w-9 h-9 flex items-center justify-center rounded-lg bg-black/20 backdrop-blur-sm border border-white/10 cursor-pointer md:hidden'
              onClick={() => setIsMenuOpen(true)}
            >
              <img src={assets.menu_icon} className='w-5 h-5 not-dark:invert' alt="Menu" />
            </button>
          )}

          {/* Main shell — sidebar + content side by side */}
          <div className='flex flex-1 min-h-0 overflow-hidden w-full'>
            <Sidebar isMenuOpen={isMenuOpen} setIsMenuOpen={setIsMenuOpen} />
            <main className='flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col'>
              <Routes>
                <Route path='/' element={<ChatBox />} />
                <Route path='/credits' element={<Credits />} />
                <Route path='/community' element={<Community />} />
              </Routes>
            </main>
          </div>
        </div>
      ) : (
        <div className='bg-gradient-to-b from-[#242124] to-[#000000] flex items-center justify-center app-shell overflow-auto'>
          <Login />
        </div>
      )}
    </>
  )
}

export default App
