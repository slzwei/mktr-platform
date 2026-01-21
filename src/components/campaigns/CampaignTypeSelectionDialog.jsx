import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, QrCode } from "lucide-react";

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
                        variant="outline"
                        className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
                        onClick={() => onSelect("brand_awareness")}
                    >
                        <div className="flex items-center w-full gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 text-blue-600 transition-colors">
                                <Car className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900">PHV Campaign</h3>
                                <p className="text-sm text-gray-500 font-normal mt-1 text-wrap">
                                    Display video or image ads on Private Hire Vehicles tablets. High visibility brand awareness.
                                </p>
                            </div>
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-auto p-4 flex flex-col items-start gap-2 border-2 hover:border-green-500 hover:bg-green-50 transition-all text-left group"
                        onClick={() => onSelect("lead_generation")}
                    >
                        <div className="flex items-center w-full gap-3">
                            <div className="p-2 bg-green-100 rounded-lg group-hover:bg-green-200 text-green-600 transition-colors">
                                <QrCode className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900">Regular Campaign</h3>
                                <p className="text-sm text-gray-500 font-normal mt-1 text-wrap">
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
