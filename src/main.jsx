import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { apiClient } from '@/api/client'

function Boot() {
  useEffect(() => {
    const token = localStorage.getItem('mktr_auth_token')
    if (token) apiClient.setToken(token)
  }, [])
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <Boot />
)