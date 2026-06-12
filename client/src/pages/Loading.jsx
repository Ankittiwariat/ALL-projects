import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { selectUser } from '../redux/slices/authSlice'
import StreamingIcon from '../components/StreamingIcon'

const Loading = () => {
  const navigate = useNavigate()
  const user = useSelector(selectUser)

  // Navigate as soon as Redux resolves the user — no artificial timeout
  useEffect(() => {
    if (user) navigate('/')
  }, [user, navigate])

  return (
    <div className='bg-gradient-to-b from-[#531B81] to-[#29184B] flex flex-col items-center justify-center h-screen w-screen text-white gap-4'>
      <StreamingIcon size={52} />
    </div>
  )
}

export default Loading
