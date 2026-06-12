import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../services/api'

const Credits = () => {
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPlanId, setSelectedPlanId] = useState("pro")


  const fetchPlans = async () => {
   try {
    const { data } = await api.get('/api/credit/plan')
    if (data.success){
      setPlans(data.plans)
    }else{
      toast.error(data.message || 'Failed to fetch plans.')
    }
   } catch (error) {
    toast.error(error.message)
   }
   setLoading(false)
  }

      const purchasePlan = async (planId) => {
        try {
          const { data } = await api.post('/api/credit/purchase', { planId })
          if (data.success) {
            window.location.href = data.url
          }else{
            toast.error(data.message)
          }
        } catch (error) {
          toast.error(error.message)
        }
      }

  useEffect(()=>{
    fetchPlans()
  },[])

  return (
    <div className='max-w-7xl h-screen overflow-y-scroll mx-auto px-4 sm:px-6 lg:px-8 py-12 relative'>
      {/* Back Button */}
      <button 
        onClick={() => navigate('/')} 
        className='absolute top-6 left-4 sm:left-6 lg:left-8 flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors cursor-pointer bg-white/50 dark:bg-black/20 p-2 px-4 rounded-full shadow-sm border border-gray-200 dark:border-white/10'
      >
        <span className='text-lg leading-none'>&larr;</span> Back to Chat
      </button>

      <h2 className='text-3xl font-semibold text-center mt-12 mb-10 text-gray-800 dark:text-white'>Credit Plans</h2>

      {loading ? (
        <div className='flex justify-center mt-20'>
          <div className='w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin'></div>
        </div>
      ) : (
      <div className='flex flex-wrap justify-center gap-8'>
        {plans.map((plan)=>(
          <div 
            key={plan._id} 
            onClick={() => setSelectedPlanId(plan._id)}
            className={`border border-gray-200 dark:border-purple-700 rounded-lg shadow hover:shadow-lg transition-all duration-300 p-6 min-w-[300px] flex flex-col cursor-pointer ${selectedPlanId === plan._id ? "bg-purple-50 dark:bg-purple-900 scale-105 border-purple-500" : "bg-white dark:bg-transparent hover:bg-gray-50 dark:hover:bg-purple-900/30"}`}
          >
            <div className='flex-1'>
              <h3 className='text-xl font-semibold text-gray-900 dark:text-white mb-2'>{plan.name}</h3>
              <p className='text-2xl font-bold text-purple-600 dark:text-purple-300 mb-4'>${plan.price}
                <span className='text-base font-normal text-gray-600 dark:text-purple-200'>{' '}/ {plan.credits} credits</span>
              </p>
              <ul className='list-disc list-inside text-sm text-gray-700 dark:text-purple-200 space-y-1'>
                {plan.features.map((feature, index)=>(
                  <li key={index}>{feature}</li>
                ))}
              </ul>
            </div>
            <button onClick={()=> toast.promise(purchasePlan(plan._id), {loading: 'Processing...'})} className='mt-6 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-medium py-2 rounded transition-colors cursor-pointer'>Buy Now</button>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

export default Credits
