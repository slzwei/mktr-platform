import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { apiClient } from '@/api/client'
import MKTRAnimatedLogo from '@/components/MKTRAnimatedLogo'

function Boot() {
  const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    const token = localStorage.getItem('mktr_auth_token')
    if (token) apiClient.setToken(token)
    const minSplashMs = 1500
    const timer = setTimeout(() => setShowSplash(false), minSplashMs)
    return () => clearTimeout(timer)
  }, [])
  return showSplash ? <MKTRAnimatedLogo /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <Boot />
)