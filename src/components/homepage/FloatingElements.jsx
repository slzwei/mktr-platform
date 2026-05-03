import { useMemo } from"react";

const FloatingElements = () => {
 const particles = useMemo(() => {
 return Array.from({ length: 20 }, (_, i) => ({
 id: i,
 left: `${Math.random() * 100}%`,
 duration: `${8 + Math.random() * 12}s`,
 delay: `${Math.random() * 10}s`,
 size: `${1 + Math.random() * 2}px`,
 }));
 }, []);

 return (
 <div className="mktr-particles">
 {particles.map((p) => (
 <div
 key={p.id}
 className="mktr-particle" style={{
 left: p.left,
 width: p.size,
 height: p.size,
 animationDuration: p.duration,
 animationDelay: p.delay,
 }}
 />
 ))}
 </div>
 );
};

export default FloatingElements;
