import { useEffect, useRef } from "react";
import { Users, TrendingUp, QrCode, Car } from "lucide-react";

const FloatingElements = () => {
  const elementsRef = useRef([]);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.pageYOffset;
      elementsRef.current.forEach((el, index) => {
        if (el) {
          const speed = 0.1 + index * 0.05;
          const yPos = -(scrolled * speed);
          el.style.transform = `translate3d(0, ${yPos}px, 0)`;
        }
      });
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="floating-elements">
      <div
        ref={(el) => elementsRef.current[0] = el}
        className="floating-element floating-element-1">

        <QrCode className="w-8 h-8 text-gray-200" />
      </div>
      <div
        ref={(el) => elementsRef.current[1] = el}
        className="floating-element floating-element-2">

        <TrendingUp className="w-6 h-6 text-gray-300" />
      </div>
      <div
        ref={(el) => elementsRef.current[2] = el}
        className="floating-element floating-element-3">

        <Users className="w-10 h-10 text-gray-100" />
      </div>
      <div
        ref={(el) => elementsRef.current[3] = el}
        className="floating-element floating-element-4">

        <Car className="w-7 h-7 text-gray-200" />
      </div>
    </div>);

};

export default FloatingElements;
