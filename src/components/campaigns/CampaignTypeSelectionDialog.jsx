import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from"@/components/ui/dialog";
import { Button } from"@/components/ui/button";
import { ClipboardCheck, Gift, QrCode, Sparkles } from"lucide-react";

export default function CampaignTypeSelectionDialog({ open, onOpenChange, onSelect }) {
 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>Create New Campaign</DialogTitle>
 <DialogDescription>
 Choose the type of campaign you want to run.
 </DialogDescription>
 </DialogHeader>
 <div className="grid grid-cols-1 gap-4 py-4">
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

 <Button
 variant="outline" className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-ring hover:bg-primary/10 transition-colors text-left group" onClick={() => onSelect("lucky_draw")}
 >
 <div className="flex items-center w-full gap-3">
 <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/15 text-primary transition-colors">
 <Gift className="w-6 h-6"/>
 </div>
 <div>
 <h3 className="font-semibold text-foreground">Lucky Draw Campaign</h3>
 <p className="text-sm text-muted-foreground font-normal mt-1 text-wrap">
 Your prizes, verified entries. SMS-verified signups earn one chance; completing a review session multiplies it. Server-enforced entries, witnessed draw, masked results.
 </p>
 </div>
 </div>
 </Button>

 <Button
 variant="outline" className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-warning hover:bg-warning/10 transition-colors text-left group" onClick={() => onSelect("quiz")}
 >
 <div className="flex items-center w-full gap-3">
 <div className="p-2 bg-warning/15 rounded-lg group-hover:bg-warning/20 text-warning transition-colors">
 <Sparkles className="w-6 h-6"/>
 </div>
 <div>
 <h3 className="font-semibold text-foreground">Quiz Campaign</h3>
 <p className="text-sm text-muted-foreground font-normal mt-1 text-wrap">
 Interactive personality quiz for paid social (IG/TikTok). Users get a result, then leave their details — round-robins to agents like a regular campaign.
 </p>
 </div>
 </div>
 </Button>

 <Button
 variant="outline" className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-primary hover:bg-primary/10 transition-colors text-left group" onClick={() => onSelect("guided_review")}
 >
 <div className="flex items-center w-full gap-3">
 <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/15 text-primary transition-colors">
 <ClipboardCheck className="w-6 h-6"/>
 </div>
 <div>
 <h3 className="font-semibold text-foreground">Guided Review Campaign</h3>
 <p className="text-sm text-muted-foreground font-normal mt-1 text-wrap">
 Long-form, editorial campaigns that qualify intent, explain a consultation, and unlock rewards after submission or attendance.
 </p>
 </div>
 </div>
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 );
}
