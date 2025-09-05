import React, { useState, useEffect } from 'react'

const MKTRAnimatedLogo = () => {
  const [borderProgress, setBorderProgress] = useState(0)
  const [flashEffect, setFlashEffect] = useState(false)
  const [glitchEffect, setGlitchEffect] = useState(false)

  const startAnimation = () => {
    setBorderProgress(0)
    setFlashEffect(false)
    setGlitchEffect(false)

    const animateProgress = () => {
      let progress = 0
      const interval = setInterval(() => {
        progress += 2
        setBorderProgress(progress)
        if (progress >= 100) {
          clearInterval(interval)
          setTimeout(() => setFlashEffect(true), 100)
          setTimeout(() => setFlashEffect(false), 400)
          setTimeout(() => setFlashEffect(true), 500)
          setTimeout(() => setFlashEffect(false), 800)
          setTimeout(() => setGlitchEffect(true), 900)
          setTimeout(() => setGlitchEffect(false), 1200)
        }
      }, 20)
    }

    setTimeout(animateProgress, 10)
  }

  useEffect(() => {
    startAnimation()
  }, [])

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh', 
      backgroundColor: 'black'
    }}>
      <div 
        onClick={startAnimation} 
        style={{ 
          cursor: 'pointer',
          position: 'relative',
          padding: '25px 40px',
          backgroundColor: flashEffect ? 'white' : 'transparent',
          transition: 'background-color 0.1s',
          borderRadius: '8px',
          border: '4px solid transparent'
        }}
      >
        <div style={{ display: 'flex', position: 'relative', zIndex: 1 }}>
          {['M', 'K', 'T', 'R'].map((letter) => (
            <div
              key={letter}
              style={{
                fontSize: '6rem',
                fontWeight: '900',
                color: flashEffect ? 'black' : 'white',
                fontFamily: 'Inter, sans-serif',
                opacity: 1,
                transform: glitchEffect ? `translate(${Math.random() * 12 - 6}px, ${Math.random() * 12 - 6}px) skew(${Math.random() * 10 - 5}deg)` : 'translateY(0)',
                textShadow: glitchEffect ? `
                  ${Math.random() * 8 - 4}px ${Math.random() * 4 - 2}px red,
                  ${Math.random() * 8 - 4}px ${Math.random() * 4 - 2}px blue,
                  ${Math.random() * 8 - 4}px ${Math.random() * 4 - 2}px green,
                  ${Math.random() * 12 - 6}px ${Math.random() * 6 - 3}px cyan,
                  ${Math.random() * 10 - 5}px ${Math.random() * 5 - 2.5}px magenta
                ` : 'none',
                transition: glitchEffect ? 'none' : 'all 0.05s'
              }}
            >
              {letter}
            </div>
          ))}
        </div>

        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: '8px',
            background: `conic-gradient(from 0deg, ${flashEffect ? 'black' : 'white'} ${borderProgress * 3.6}deg, transparent ${borderProgress * 3.6}deg)`,
            padding: '4px',
            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            maskComposite: 'xor',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            boxShadow: glitchEffect ? '0 0 10px red, 0 0 20px blue' : 'none'
          }}
        />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@900&display=swap');
      `}</style>
    </div>
  )
}

export default MKTRAnimatedLogo


