import { useEffect, useRef } from"react";

const ParallaxSection = ({ children, backgroundImage, speed = 0.5, className =""}) => {
 const parallaxRef = useRef(null);

 useEffect(() => {
 const handleScroll = () => {
 if (parallaxRef.current) {
 const scrolled = window.pageYOffset;
 const parallax = scrolled * speed;
 parallaxRef.current.style.transform = `translateY(${parallax}px)`;
 }
 };

 window.addEventListener('scroll', handleScroll);
 return () => window.removeEventListener('scroll', handleScroll);
 }, [speed]);

 return (
 <div className={`parallax-section ${className}`}>
 {backgroundImage &&
 <div
 ref={parallaxRef}
 className="parallax-bg" style={{
 backgroundImage: `url(${backgroundImage})`,
 backgroundSize: 'cover',
 backgroundPosition: 'center',
 backgroundAttachment: 'fixed'
 }} />

 }
 <div className={`parallax-content ${className.includes('flex') ? 'flex items-center justify-center' : ''}`}>
 {children}
 </div>
 </div>);

};

export default ParallaxSection;
