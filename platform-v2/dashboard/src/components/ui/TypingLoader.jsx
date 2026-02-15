import { useState, useEffect } from "react";

export default function TypingLoader() {
  const [text, setText] = useState("");
  const fullText = "MKTR.";
  
  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index <= fullText.length) {
        setText(fullText.slice(0, index));
        index++;
      } else {
        clearInterval(timer); // Stop the animation from looping
      }
    }, 300); // Adjust speed as needed
    
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="text-center">
        <h1 
          className="text-4xl font-bold text-white tracking-wider"
          style={{ fontFamily: '"Gilroy", "Inter", sans-serif' }}
        >
          {text}
          <span className="animate-pulse">|</span>
        </h1>
      </div>
    </div>
  );
}