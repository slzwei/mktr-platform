import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";

const AnnouncementModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeenModal = localStorage.getItem('mktr-modal-seen');
    if (!hasSeenModal) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeModal = () => {
    setIsOpen(false);
    localStorage.setItem('mktr-modal-seen', 'true');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={closeModal}>
          <X className="w-6 h-6" />
        </button>
        <div className="modal-body">
          <h3 className="modal-title">Welcome to MKTR.</h3>
          <p className="modal-text">
            Singapore's premier marketer platform for intelligent lead generation.
            Get started with smart prospect capture and campaign management.
          </p>
          <Link to={"/AdminDashboard"}>
            <Button className="modal-cta">
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>);

};

export default AnnouncementModal;
