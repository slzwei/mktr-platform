import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from"@/components/ui/dialog";
import { Button } from"@/components/ui/button";
import { Car, QrCode } from"lucide-react";

export default function CampaignTypeSelectionDialog({ open, onOpenChange, onSelect }) {
 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle>Create New Campaign</DialogTitle>
 <DialogDescription>
 Choose the type of campaign you want to run.
 </DialogDescription>
 </DialogHeader>
 <div className="grid grid-cols-1 gap-4 py-4">
 <Button
 variant="outline" className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-ring hover:bg-primary/10 transition-colors text-left group" onClick={() => onSelect("brand_awareness")}
 >
 <div className="flex items-center w-full gap-3">
 <div className="p-2 bg-info/15 rounded-lg group-hover:bg-info/20 text-primary transition-colors">
 <Car className="w-6 h-6"/>
 </div>
 <div>
 <h3 className="font-semibold text-foreground">PHV Campaign</h3>
 <p className="text-sm text-muted-foreground font-normal mt-1 text-wrap">
 Display video or image ads on Private Hire Vehicles tablets. High visibility brand awareness.
 </p>
 </div>
 </div>
 </Button>

 <Button
 variant="outline" className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-success hover:bg-success/10 transition-colors text-left group" onClick={() => onSelect("lead_generation")}
 >
 <div className="flex items-center w-full gap-3">
 <div className="p-2 bg-success/15 rounded-lg group-hover:bg-success/20 text-success transition-colors">
 <QrCode className="w-6 h-6"/>
 </div>
 <div>
 <h3 className="font-semibold text-foreground">Regular Campaign</h3>
 <p className="text-sm text-muted-foreground font-normal mt-1 text-wrap">
 Standard QR code campaigns for lead generation. Perfect for events and direct sign-ups.
 </p>
 </div>
 </div>
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 );
}
