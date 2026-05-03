import { useState, useEffect, useMemo } from"react";

const TypewriterText = ({ text, speed = 100, delay = 0 }) => {
 // Normalize: replace literal"\n"with real newlines
 const sourceText = useMemo(
 () =>
 String(text).
 replace(/\r\n/g,"\n").
 replace(/\r/g,"\n").
 replace(/\\n/g,"\n"),
 [text]
 );

 const [displayText, setDisplayText] = useState("");
 const [currentIndex, setCurrentIndex] = useState(0);

 useEffect(() => {
 setDisplayText("");
 setCurrentIndex(0);
 }, [sourceText]);

 useEffect(() => {
 const timer = setTimeout(() => {
 if (currentIndex < sourceText.length) {
 setDisplayText((prev) => prev + sourceText[currentIndex]);
 setCurrentIndex((prev) => prev + 1);
 }
 }, currentIndex === 0 ? delay : speed);

 return () => clearTimeout(timer);
 }, [currentIndex, sourceText, speed, delay]);

 return (
 <span className="whitespace-pre-line text-background">
 {displayText}
 {/* Cursor always blinks, even after typing finishes */}
 <span className="blinking-cursor">|</span>
 </span>);

};

export default TypewriterText;
