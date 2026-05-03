import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from '@/App.jsx'
import '@/index.css'
import { queryClient } from '@/lib/queryClient'
import MKTRAnimatedLogo from '@/components/MKTRAnimatedLogo'

// Initialize Sentry
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
 Sentry.init({
 dsn: sentryDsn,
 environment: import.meta.env.MODE,
 tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
 replaysSessionSampleRate: 0,
 replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,
 })
}

function Boot() {
 const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem('mktr_splash_shown') !== '1')
 useEffect(() => {
 // API client now reads token from localStorage on each request — no manual setToken needed
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
 <Sentry.ErrorBoundary fallback={<div className="min-h-screen flex items-center justify-center"><p>Something went wrong. Please refresh the page.</p></div>}>
 <QueryClientProvider client={queryClient}>
 <Boot />
 <ReactQueryDevtools initialIsOpen={false} />
 </QueryClientProvider>
 </Sentry.ErrorBoundary>
)