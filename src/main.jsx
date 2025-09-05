import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { apiClient } from '@/api/client'
import MKTRAnimatedLogo from '@/components/MKTRAnimatedLogo'

function Boot() {
  const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem('mktr_splash_shown') !== '1')
  useEffect(() => {
    const token = localStorage.getItem('mktr_auth_token')
    if (token) apiClient.setToken(token)
    if (showSplash) {
      const minSplashMs = 1500
      const timer = setTimeout(() => {
        sessionStorage.setItem('mktr_splash_shown', '1')
        setShowSplash(false)
      }, minSplashMs)
      return () => clearTimeout(timer)
    }
  }, [])
  return showSplash ? <MKTRAnimatedLogo /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <Boot />
)