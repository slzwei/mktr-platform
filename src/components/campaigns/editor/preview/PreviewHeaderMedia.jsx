import { Video } from"lucide-react";
import { resolveImageUrl } from"../../LeadCaptureLayout";

export default function PreviewHeaderMedia({ currentDesign }) {
 if (currentDesign.mediaType === 'video' && currentDesign.videoUrl) {
 return (
 <div className="w-full bg-foreground" style={{ aspectRatio: '16/9' }}>
 {/youtube|youtu\.be/.test(currentDesign.videoUrl) ? (
 <div className="w-full h-full flex items-center justify-center text-background text-xs">
 <Video className="w-5 h-5 mr-1.5 text-destructive"/>
 <span className="text-muted-foreground">YouTube Video</span>
 </div>
 ) : (
 <video src={resolveImageUrl(currentDesign.videoUrl)} className="w-full h-full object-cover" muted playsInline preload="metadata"/>
 )}
 </div>
 );
 }

 if (currentDesign.mediaType !== 'none' && currentDesign.imageUrl) {
 return (
 <div className="w-full relative h-48 sm:h-56 bg-muted border-b border-border/50">
 <img src={resolveImageUrl(currentDesign.imageUrl)} alt="Campaign Header" loading="lazy" decoding=" async" className="w-full h-full object-cover"/>
 <div className="absolute inset-0 bg-gradient-to-t from-foreground/20 to-transparent pointer-events-none" aria-hidden="true"/>
 </div>
 );
 }

 if (currentDesign.mediaType !== 'none') {
 return (
 <div className="h-48 bg-muted flex items-center justify-center border-b border-border">
 <div className="text-center">
 <div className="w-12 h-12 bg-muted rounded-lg mx-auto mb-2"/>
 <span className="text-xs text-muted-foreground">Header Media</span>
 </div>
 </div>
 );
 }

 return null;
}
