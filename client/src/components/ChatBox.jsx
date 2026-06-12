import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAppContext } from '../context/AppContext'
import { assets } from '../assets/assets'
import Message from './Message'
import toast from 'react-hot-toast'
import { useDispatch, useSelector } from 'react-redux'
import { selectTheme } from '../redux/slices/themeSlice'
import { selectUser, decrementCredits } from '../redux/slices/authSlice'
import { selectSelectedChat, createNewChat, updateChatName } from '../redux/slices/chatSlice'
import { 
  selectMessages, 
  selectMessageLoading, 
  setMessages, 
  clearMessages,
  addOptimisticMessage, 
  sendMessage,
  beginStreamingMessage,
  appendStreamingToken,
  finalizeStreamingMessage,
  cancelStreamingMessage,
} from '../redux/slices/messageSlice'

const VITE_SERVER_URL = import.meta.env.VITE_SERVER_URL || ''

const DIRECTIONS = {
  tv_to_en: { from: 'Te Tuvalu', to: 'English' },
  en_to_tv: { from: 'English', to: 'Te Tuvalu' },
}



const ChatBox = () => {

  const containerRef    = useRef(null)
  const textareaRef     = useRef(null)
  const abortControllerRef = useRef(null)
  const dispatch = useDispatch()

  const user         = useSelector(selectUser)
  const selectedChat = useSelector(selectSelectedChat)
  const messages     = useSelector(selectMessages)
  const loading      = useSelector(selectMessageLoading)
  const theme        = useSelector(selectTheme)

  const [prompt, setPrompt]                   = useState('')
  const [mode, setMode]                       = useState('translate')
  const [isPublished, setIsPublished]         = useState(false)
  const [translateDirection, setTranslateDirection] = useState('tv_to_en')
  const [isDropdownOpen, setIsDropdownOpen]   = useState(false)
  const dropdownRef = useRef(null)

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [prompt])



  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const dir = DIRECTIONS[translateDirection]
  const MAX_PROMPT_CHARS = mode === 'image' ? 1000 : 2000

  const swapDirection = useCallback(() => {
    setTranslateDirection(prev => prev === 'tv_to_en' ? 'en_to_tv' : 'tv_to_en')
  }, [])

  const handleStop = () => abortControllerRef.current?.abort()

  // ── SSE helpers ───────────────────────────────────────────────────────────
  const readSSEStream = async (response, chatId) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        let eventName = null
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim()
            let parsed
            try { parsed = JSON.parse(rawData) } catch { continue }

            if (eventName === 'token') {
              dispatch(appendStreamingToken(parsed.token))
            } else if (eventName === 'done') {
              dispatch(finalizeStreamingMessage(parsed.reply))
              if (parsed.chatName) dispatch(updateChatName({ chatId, name: parsed.chatName }))
            } else if (eventName === 'error') {
              dispatch(cancelStreamingMessage())
              toast.error(parsed.message || 'An error occurred.', { id: 'stream-err' })
              return { error: true }
            }
            eventName = null
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch(finalizeStreamingMessage({ role: 'assistant', content: null, timestamp: Date.now(), isImage: false }))
        return { error: false, aborted: true }
      }
      throw err
    }
    return { error: false }
  }

  const sendStreamingMessage = async (chatId, promptText) => {
    const token = localStorage.getItem('token')
    const url = `${VITE_SERVER_URL}/api/message/text/stream?token=${encodeURIComponent(token)}&chatId=${chatId}&prompt=${encodeURIComponent(promptText)}`
    const controller = new AbortController()
    abortControllerRef.current = controller
    dispatch(beginStreamingMessage())

    let response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch(finalizeStreamingMessage({ role: 'assistant', content: null, timestamp: Date.now(), isImage: false }))
        return { error: false, aborted: true }
      }
      dispatch(cancelStreamingMessage())
      toast.error('Failed to connect to server.', { id: 'stream-err' })
      return { error: true }
    }
    if (!response.ok) {
      dispatch(cancelStreamingMessage())
      toast.error('Failed to get a response from AI.', { id: 'stream-err' })
      return { error: true }
    }
    return readSSEStream(response, chatId)
  }

  const sendStreamingTranslation = async (chatId, textToTranslate, dirCode) => {
    const token = localStorage.getItem('token')
    const url = `${VITE_SERVER_URL}/api/translate/stream?token=${encodeURIComponent(token)}&chatId=${chatId}&text=${encodeURIComponent(textToTranslate)}&direction=${dirCode}`
    const controller = new AbortController()
    abortControllerRef.current = controller
    dispatch(beginStreamingMessage())

    let response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch(finalizeStreamingMessage({ role: 'assistant', content: null, timestamp: Date.now(), isImage: false }))
        return { error: false, aborted: true }
      }
      dispatch(cancelStreamingMessage())
      toast.error('Failed to connect to server.', { id: 'stream-err' })
      return { error: true }
    }
    if (!response.ok) {
      dispatch(cancelStreamingMessage())
      toast.error('Failed to get a response from AI.', { id: 'stream-err' })
      return { error: true }
    }
    return readSSEStream(response, chatId)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const onSubmit = async (e) => {
    e.preventDefault()
    if (!user) return toast.error('Please log in to send a message', { id: 'auth-required' })
    if (!prompt.trim()) return
    if (prompt.trim().length > MAX_PROMPT_CHARS) {
      return toast.error(`Prompt too long — max ${MAX_PROMPT_CHARS} characters`, { id: 'prompt-too-long' })
    }

    const promptCopy = prompt
    setPrompt('')

    let targetChatId = selectedChat?._id
    if (!targetChatId) {
      const createResult = await dispatch(createNewChat())
      if (createNewChat.rejected.match(createResult)) {
        setPrompt(promptCopy)
        return
      }
      targetChatId = createResult.payload._id
    }

    if (mode === 'translate') {
      const directionLabel = translateDirection === 'tv_to_en' ? '(Translate to English)' : '(Translate to Te Tuvalu)'
      dispatch(addOptimisticMessage({
        role: 'user',
        content: `**${directionLabel}**\n\n${promptCopy}`,
        timestamp: Date.now(),
        isImage: false
      }))
      const result = await sendStreamingTranslation(targetChatId, promptCopy, translateDirection)
      if (result.error) { dispatch({ type: 'message/removeLastMessage' }); setPrompt(promptCopy) }
      else dispatch(decrementCredits(1))

    } else if (mode === 'text') {
      dispatch(addOptimisticMessage({ role: 'user', content: promptCopy, timestamp: Date.now(), isImage: false }))
      const result = await sendStreamingMessage(targetChatId, promptCopy)
      if (result.error) { dispatch({ type: 'message/removeLastMessage' }); setPrompt(promptCopy) }
      else dispatch(decrementCredits(1))

    } else {
      dispatch(addOptimisticMessage({ role: 'user', content: promptCopy, timestamp: Date.now(), isImage: false }))
      const resultAction = await dispatch(sendMessage({ mode, chatId: targetChatId, prompt: promptCopy, isPublished }))
      if (sendMessage.rejected.match(resultAction)) { dispatch({ type: 'message/removeLastMessage' }); setPrompt(promptCopy) }
      else dispatch(decrementCredits(2))
    }
  }

  // ── Enter = submit, Shift+Enter = new line ────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!loading && prompt.trim()) onSubmit(e)
    }
  }

  // ── Sync messages ─────────────────────────────────────────────────────────
  const currentChatIdRef = useRef(null)
  useEffect(() => {
    if (selectedChat && selectedChat._id !== currentChatIdRef.current) {
      currentChatIdRef.current = selectedChat._id
      dispatch(setMessages(selectedChat.messages))
    } else if (!selectedChat) {
      currentChatIdRef.current = null
      dispatch(clearMessages())
    }
  }, [selectedChat?._id, dispatch])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const timer = setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [messages, loading])

  const placeholderText = mode === 'translate'
    ? `Type in English or Te Tuvalu…`
    : 'Type your prompt… (Shift+Enter for new line)'

  return (
    /*
     * iOS Safari Fix:
     * Do NOT use h-screen / 100vh. This component lives inside a parent that
     * already has the correct dvh height. Use h-full + min-h-0 + overflow-hidden
     * so it exactly fills that space without overflowing.
     *
     * The key insight: flex-col with flex-1/min-h-0 on the messages area and
     * flex-shrink-0 on the input area ensures the input is ALWAYS at the bottom
     * and ALWAYS visible, even on iOS Safari.
     */
    <div
      className='flex flex-col w-full overflow-hidden'
      style={{ height: '100%' }}
    >
      {/* ── Messages — scrollable flex child ────────────────────────────────── */}
      <div
        ref={containerRef}
        className='flex-1 min-h-0 overflow-y-auto'
        style={{ WebkitOverflowScrolling: 'touch' }}  /* smooth momentum scroll on iOS */
      >
        <div className='px-4 sm:px-8 xl:px-16 py-4 max-w-4xl mx-auto w-full'>
          {messages.length === 0 && (
            <div className='flex flex-col items-center justify-center gap-2 text-primary pt-16'>
              <img
                src={theme === 'dark' ? assets.logo_te_tuvalu : assets.logo_te_tuvalu_gpt}
                alt=""
                className='w-full max-w-48 sm:max-w-60'
              />
              <p className='mt-5 text-3xl sm:text-5xl text-center text-gray-400 dark:text-white'>
                Ask me anything.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <Message key={index} message={message} />
          ))}
        </div>
      </div>

      {/* ── Input area — flex-shrink-0 so it NEVER gets squished or hidden ─── */}
      <div
        className='flex-shrink-0 w-full'
        style={{
          /* Safe area for iPhone home indicator (bottom of screen) */
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        }}
      >
        <div className='px-3 sm:px-6 xl:px-12 pb-3 pt-2 max-w-3xl mx-auto w-full'>

          {/* Image publish toggle */}
          {mode === 'image' && (
            <label className='flex items-center justify-center gap-2 mb-2 text-sm'>
              <p className='text-xs text-gray-400'>Publish Generated Image to Community</p>
              <input type="checkbox" className='cursor-pointer' checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            </label>
          )}

          {/* Translation direction */}
          {mode === 'translate' && (
            <div className='flex items-center justify-center mb-2'>
              <div
                key={translateDirection}
                className='flex items-center gap-2 p-1 rounded-full bg-primary/20 dark:bg-[#583C79]/30 border border-primary dark:border-[#80609F]/30'
                style={{ transition: 'all 0.3s ease' }}
              >
                <div className='px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-[#8b5cf6] to-[#4f46e5] text-white whitespace-nowrap' style={{ transition: 'all 0.3s ease' }}>
                  {dir.from}
                </div>
                <button
                  type="button"
                  onClick={swapDirection}
                  className='p-1.5 rounded-full hover:bg-white/10 text-gray-400 cursor-pointer transition-colors'
                  aria-label="Swap translation direction"
                >
                  <svg className='w-3 h-3' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.5} d='M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' />
                  </svg>
                </button>
                <div className='px-3 py-1 text-xs font-medium text-gray-400 whitespace-nowrap' style={{ transition: 'all 0.3s ease' }}>
                  {dir.to}
                </div>
              </div>
            </div>
          )}

          {/* ── Form ─────────────────────────────────────────────────────────── */}
          <form
            onSubmit={onSubmit}
            className='bg-primary/20 dark:bg-[#583C79]/30 border border-primary dark:border-[#80609F]/30 rounded-2xl w-full px-3 py-2.5 flex gap-2 items-end'
          >
            {/* Mode Dropdown */}
            <div className='relative flex-shrink-0 self-end pb-0.5' ref={dropdownRef}>
              <button
                type='button'
                onClick={() => setIsDropdownOpen(prev => !prev)}
                className='flex items-center gap-1 text-sm text-gray-700 dark:text-white font-medium cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap'
              >
                {mode === 'text' ? 'Chat' : 'Translate'}
                <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
                </svg>
              </button>

              {isDropdownOpen && (
                <div className='absolute bottom-full left-0 mb-3 w-36 bg-white dark:bg-[#2A1B38] border border-gray-200 dark:border-[#583C79] rounded-xl shadow-xl overflow-hidden z-50'>
                  {/* Chat — disabled */}
                  <div
                    title="for admin only"
                    className='px-4 py-3 text-sm cursor-not-allowed opacity-50 flex items-center gap-2 text-gray-700 dark:text-gray-300 select-none'
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Chat
                  </div>
                  {/* Translate — active */}
                  <div
                    onClick={() => { setMode('translate'); setIsDropdownOpen(false) }}
                    className={`px-4 py-3 text-sm cursor-pointer flex items-center gap-2 transition-colors ${
                      mode === 'translate'
                        ? 'bg-primary/10 dark:bg-[#80609F]/30 text-primary dark:text-white font-semibold'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                    </svg>
                    Translate
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className='w-px self-stretch bg-gray-300 dark:bg-white/20 flex-shrink-0 my-0.5' />

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              disabled={loading}
              rows={1}
              className='chat-textarea flex-1 outline-none bg-transparent placeholder-gray-500 dark:text-white text-gray-800'
            />

            {/* Send / Stop */}
            <div className='flex-shrink-0 self-end pb-0.5'>
              {loading ? (
                <button type='button' onClick={handleStop} className='cursor-pointer' aria-label="Stop">
                  <img src={assets.stop_icon} className='w-7 h-7' alt='Stop' />
                </button>
              ) : (
                <button
                  type='submit'
                  disabled={!prompt.trim()}
                  className='cursor-pointer disabled:opacity-40 transition-opacity'
                  aria-label="Send"
                >
                  <img src={assets.send_icon} className='w-7 h-7 hover:scale-105 transition-transform' alt='Send' />
                </button>
              )}
            </div>
          </form>

          {/* Char counter */}
          {prompt.length > MAX_PROMPT_CHARS * 0.8 && (
            <p className={`text-center text-xs mt-1 ${prompt.length > MAX_PROMPT_CHARS ? 'text-red-400' : 'text-gray-400'}`}>
              {prompt.length} / {MAX_PROMPT_CHARS}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatBox
