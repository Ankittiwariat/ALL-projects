import React, { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { assets } from '../assets/assets'
import moment from 'moment'
import toast from 'react-hot-toast'
import { useSelector, useDispatch } from 'react-redux'
import { toggleTheme, selectTheme, updateThemeToServer } from '../redux/slices/themeSlice'
import { selectUser, logoutUser } from '../redux/slices/authSlice'
import { selectChats, setSelectedChat, createNewChat, deleteChat, selectIsDeleting } from '../redux/slices/chatSlice'

const Sidebar = ({ isMenuOpen, setIsMenuOpen }) => {

    const { navigate } = useAppContext()
    const user = useSelector(selectUser)
    const chats = useSelector(selectChats)
    const isDeleting = useSelector(selectIsDeleting)
    const theme = useSelector(selectTheme)
    const dispatch = useDispatch()

    const [search, setSearch] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [chatToDelete, setChatToDelete] = useState(null)

    const logout = () => {
        dispatch(logoutUser())
        toast.success('Logged out successfully')
    }

    const handleToggleTheme = () => {
        dispatch(toggleTheme())
        const newTheme = theme === 'dark' ? 'light' : 'dark'
        dispatch(updateThemeToServer(newTheme))
    }

    const openDeleteModal = (e, chatId) => {
        e.stopPropagation()
        setChatToDelete(chatId)
        setIsModalOpen(true)
    }

    const handleDeleteChat = async () => {
        if (!chatToDelete) return
        await dispatch(deleteChat(chatToDelete))
        setIsModalOpen(false)
        setChatToDelete(null)
    }

    const filteredChats = chats.filter((chat) =>
        chat.messages[0]
            ? chat.messages[0]?.content.toLowerCase().includes(search.toLowerCase())
            : chat.name.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <>
            {/*
             * Sidebar panel.
             *
             * KEY iOS FIX:
             * Do NOT use h-screen (100vh). Instead use height: 100% so it
             * inherits the true visible height from its parent (which uses dvh).
             * The sidebar is position:fixed on mobile so it also needs an
             * explicit height — we use 100dvh with -webkit-fill-available fallback.
             */}
            <aside
                style={{
                    /* iOS Safari: use fill-available so the sidebar height
                       accounts for the address bar / tab bar */
                    height: '100%',
                }}
                className={`
                    flex flex-col w-72 flex-shrink-0 p-5
                    dark:bg-gradient-to-b from-[#242124]/95 to-[#000000]/95
                    border-r border-[#80609F]/30 backdrop-blur-3xl
                    transition-transform duration-300
                    md:relative md:translate-x-0 md:h-full
                    fixed left-0 top-0 z-20
                    ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
                /* On mobile, the aside is fixed so set dvh explicitly */
                ref={(el) => {
                    if (el && window.innerWidth < 768) {
                        el.style.height = window.innerHeight + 'px'
                    }
                }}
            >
                {/* Close button — mobile only */}
                <button
                    aria-label="Close sidebar"
                    onClick={() => setIsMenuOpen(false)}
                    className='absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors cursor-pointer md:hidden flex-shrink-0'
                >
                    <img src={assets.close_icon} className='w-4 h-4 not-dark:invert' alt="Close" />
                </button>

                {/* Logo */}
                <img
                    onClick={() => { navigate('/'); setIsMenuOpen(false) }}
                    src={theme === 'dark' ? assets.logo_te_tuvalu : assets.logo_te_tuvalu_gpt}
                    alt="Te Tuvalu GPT"
                    className='w-full max-w-44 cursor-pointer flex-shrink-0'
                />

                {/* New Chat Button */}
                <button
                    onClick={() => { dispatch(createNewChat()); setIsMenuOpen(false) }}
                    className='flex justify-center items-center w-full py-2.5 mt-6 text-white bg-gradient-to-r from-[#A456F7] to-[#3D81F6] text-sm rounded-md cursor-pointer flex-shrink-0 hover:opacity-90 transition-opacity'
                >
                    <span className='mr-2 text-lg leading-none'>+</span> New Chat
                </button>

                {/* Search Conversations */}
                <div className='flex items-center gap-2 p-2.5 mt-4 border border-gray-400 dark:border-white/20 rounded-md flex-shrink-0'>
                    <img src={assets.search_icon} className='w-4 flex-shrink-0 not-dark:invert' alt="" />
                    <input
                        onChange={(e) => setSearch(e.target.value)}
                        value={search}
                        type="text"
                        placeholder='Search conversations'
                        className='text-xs text-gray-700 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none bg-transparent w-full'
                    />
                </div>

                {/* Recent Chats — THIS section scrolls */}
                {chats.length > 0 && (
                    <p className='mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex-shrink-0'>
                        Recent Chats
                    </p>
                )}
                <div className='flex-1 overflow-y-auto min-h-0 space-y-1.5 -mr-1 pr-1'>
                    {filteredChats.map((chat) => (
                        <div
                            onClick={() => { navigate('/'); dispatch(setSelectedChat(chat)); setIsMenuOpen(false) }}
                            key={chat._id}
                            className='p-2 px-3 dark:bg-[#57317C]/10 border border-gray-300 dark:border-[#80609F]/15 rounded-md cursor-pointer flex justify-between items-center group transition-colors duration-200 hover:bg-gray-100 dark:hover:bg-white/5'
                        >
                            <div className='min-w-0 flex-1'>
                                <p className='truncate text-gray-800 dark:text-white text-sm'>
                                    {chat.messages.length > 0 ? chat.messages[0].content.slice(0, 30) : chat.name}
                                </p>
                                <p className='text-xs text-gray-500 dark:text-[#B1A6C0] mt-0.5'>
                                    {moment(chat.updatedAt).fromNow()}
                                </p>
                            </div>
                            <button
                                className='hidden group-hover:flex items-center justify-center ml-2 flex-shrink-0 w-7 h-7 rounded hover:bg-red-500/10 transition-colors'
                                onClick={e => openDeleteModal(e, chat._id)}
                                aria-label="Delete chat"
                            >
                                <img src={assets.bin_icon} className='w-4 not-dark:invert' alt="Delete" />
                            </button>
                        </div>
                    ))}
                </div>

                {/*
                 * Bottom Actions — flex-shrink-0 is CRITICAL.
                 * Without it, iOS flex layout can squish or hide these items
                 * when the sidebar height is miscalculated.
                 */}
                <div className='flex-shrink-0 mt-3 space-y-2 border-t border-gray-200 dark:border-white/10 pt-3'>
                    {/* Credits */}
                    <div
                        onClick={() => { navigate('/credits'); setIsMenuOpen(false) }}
                        className='flex items-center gap-2 p-2.5 border border-gray-300 dark:border-white/15 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors'
                    >
                        <img src={assets.diamond_icon} className='w-4 flex-shrink-0 dark:invert' alt="" />
                        <div className='flex flex-col text-sm min-w-0'>
                            <p className='text-gray-800 dark:text-white text-sm leading-tight'>Credits : {user?.credits}</p>
                            <p className='text-xs text-gray-500 dark:text-purple-200 truncate mt-0.5'>Purchase credits</p>
                        </div>
                    </div>

                    {/* Dark Mode Toggle */}
                    <div className='flex items-center justify-between gap-2 p-2.5 border border-gray-300 dark:border-white/15 rounded-md'>
                        <div className='flex items-center gap-2 text-sm'>
                            <img src={assets.theme_icon} className='w-4 flex-shrink-0 not-dark:invert' alt="" />
                            <p className='text-gray-800 dark:text-white text-sm'>Dark Mode</p>
                        </div>
                        <label className='relative inline-flex cursor-pointer flex-shrink-0'>
                            <input onChange={handleToggleTheme} type="checkbox" className="sr-only peer" checked={theme === 'dark'} />
                            <div className='w-9 h-5 bg-gray-400 rounded-full peer-checked:bg-purple-600 transition-all'></div>
                            <span className='absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4'></span>
                        </label>
                    </div>

                    {/* User Account + Logout — ALWAYS visible (not hover-only) */}
                    <div className='flex items-center gap-2 p-2.5 border border-gray-300 dark:border-white/15 rounded-md'>
                        <img src={assets.user_icon} className='w-7 h-7 rounded-full flex-shrink-0' alt="" />
                        <p className='flex-1 text-sm text-gray-800 dark:text-white truncate min-w-0'>
                            {user ? user.name : 'Guest'}
                        </p>
                        {user && (
                            <button
                                onClick={logout}
                                title="Logout"
                                className='flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full hover:bg-red-500/15 active:bg-red-500/25 transition-colors cursor-pointer'
                                aria-label="Logout"
                            >
                                <img src={assets.logout_icon} className='w-5 h-5 not-dark:invert' alt="Logout" />
                            </button>
                        )}
                    </div>
                </div>
            </aside>

            {/* Delete Modal */}
            {isModalOpen && (
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'>
                    <div className='bg-white dark:bg-[#1E1B21] border border-gray-200 dark:border-[#80609F]/20 p-6 rounded-lg shadow-2xl max-w-sm w-full'>
                        <h3 className='text-lg font-semibold text-gray-800 dark:text-white'>Delete Conversation?</h3>
                        <p className='text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed'>
                            Are you sure you want to delete this conversation? This action cannot be undone.
                        </p>
                        <div className='flex gap-3 mt-6 justify-end'>
                            <button
                                onClick={() => { setIsModalOpen(false); setChatToDelete(null) }}
                                className='px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-[#322A38] dark:hover:bg-[#43394A] text-gray-700 dark:text-gray-300 rounded-md transition-colors cursor-pointer'
                            >
                                Cancel
                            </button>
                            <button
                                disabled={isDeleting}
                                onClick={handleDeleteChat}
                                className='px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors cursor-pointer disabled:opacity-50'
                            >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

export default Sidebar
