import React, { useEffect } from 'react'
import { assets } from '../assets/assets'
import moment from 'moment'
import Markdown from 'react-markdown'
import Prism from 'prismjs'
import StreamingIcon from './StreamingIcon'

const Message = ({ message }) => {

  useEffect(() => {
    Prism.highlightAll()
  }, [message.content])

  // ── Waiting for first token: show spinner only, no bubble ────────────────
  if (message.isStreaming && message.content === '') {
    return (
      <div className='flex items-center my-4'>
        <StreamingIcon size={22} />
      </div>
    )
  }

  return (
    <div>
      {message.role === 'user' ? (
        // ── User bubble ───────────────────────────────────────────────────
        <div className='flex items-start justify-end my-4 gap-2'>
          <div className='flex flex-col gap-2 p-2 px-4 bg-slate-50 dark:bg-[#57317C]/30 border border-[#80609F]/30 rounded-md max-w-2xl'>
            <p className='text-sm dark:text-primary'>{message.content}</p>
            <span className='text-xs text-gray-400 dark:text-[#B1A6C0]'>
              {moment(message.timestamp).fromNow()}
            </span>
          </div>
          <img src={assets.user_icon} alt='' className='w-8 rounded-full' />
        </div>
      ) : (
        // ── AI bubble ─────────────────────────────────────────────────────
        <>
          <div className='inline-flex flex-col gap-2 p-2 px-4 max-w-2xl bg-primary/20 dark:bg-[#57317C]/30 border border-[#80609F]/30 rounded-md my-4'>
            {message.isImage ? (
              <img src={message.content} alt='' className='w-full max-w-md mt-2 rounded-md' />
            ) : (
              <div className='text-sm dark:text-primary reset-tw'>
                <Markdown>{message.content}</Markdown>
              </div>
            )}
            {!message.isStreaming && (
              <div className='flex items-center gap-3 mt-1'>
                <span className='text-xs text-gray-400 dark:text-[#B1A6C0]'>
                  {moment(message.timestamp).fromNow()}
                </span>
                
                {/* Confidence Badge */}
                {message.responseLevel === 1 || message.responseLevel === 1.5 ? (
                  <span className='text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50' title="Exact or Fuzzy Dataset Match">
                    ★★★★★ Dataset Match
                  </span>
                ) : message.responseLevel === 2 ? (
                  <span className='text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50' title="RAG Retrieval">
                    ★★★★☆ RAG Match
                  </span>
                ) : message.responseLevel === 3 ? (
                  <span className='text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700' title="AI Generated Fallback">
                    ★★★☆☆ AI Generated
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {/* Spinner shown BELOW the bubble while streaming */}
          {message.isStreaming && (
            <div className='flex items-center mb-2'>
              <StreamingIcon size={22} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Message
