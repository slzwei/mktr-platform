import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { brand } from "@/lib/brand";

const AnnouncementModal = () => {
 const [isOpen, setIsOpen] = useState(false);

 useEffect(() => {
 const hasSeenModal = localStorage.getItem('mktr-modal-seen');
 if (!hasSeenModal) {
 const timer = setTimeout(() => setIsOpen(true), 2000);
 return () => clearTimeout(timer);
 }
 }, []);

 const closeModal = () => {
 setIsOpen(false);
 localStorage.setItem('mktr-modal-seen', 'true');
 };

 return (
 <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : closeModal())}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle className="font-serif text-xl">Welcome to {brand.wordmark}</DialogTitle>
 <DialogDescription>
 Singapore's premier marketer platform for intelligent lead generation.
 Get started with smart prospect capture and campaign management.
 </DialogDescription>
 </DialogHeader>
 <Link to="/AdminDashboard" onClick={closeModal} className="inline-block">
 <Button className="w-full">
 Get Started
 <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
 </Button>
 </Link>
 </DialogContent>
 </Dialog>
 );
};

export default AnnouncementModal;
