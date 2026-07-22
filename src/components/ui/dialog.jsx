"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import X from "lucide-react/icons/x"

import { cn } from "@/lib/utils"
import { usePortalContainer } from "@/lib/portalContainerContext"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
 <DialogPrimitive.Overlay
 ref={ref}
 className={cn(
 "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
 className
 )}
 {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// `variant="sheet"` (customer-funnel modals): phone-style bottom sheet under
// 640px — slides up from the bottom edge on open and back down on close — and
// a centered card with a soft rise/settle (no zoom) from sm up. The classes
// are swapped wholesale rather than merged because tailwindcss-animate's
// slide-* utilities all write the same --tw-enter/exit vars, so stylesheet
// order (not className order) would decide a merge.
const dialogContentVariants = {
 default:
 "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-micro data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
 sheet:
 "fixed inset-x-0 bottom-0 top-auto z-50 grid w-full max-w-full gap-4 border bg-background p-6 shadow-lg rounded-t-2xl duration-base ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=open]:slide-in-from-top-[46%] sm:data-[state=closed]:slide-out-to-top-[46%]",
}

const DialogContent = React.forwardRef(({ className, children, hideClose, variant = "default", ...props }, ref) => {
 // Containment override for trees rendered inside the Studio DeviceFrame
 // iframe; undefined (the default everywhere else) keeps Radix's own
 // document.body portal, byte-identical to before.
 const portalContainer = usePortalContainer()
 return (
 <DialogPortal container={portalContainer}>
 <DialogOverlay />
 <DialogPrimitive.Content
 ref={ref}
 className={cn(
 dialogContentVariants[variant] ?? dialogContentVariants.default,
 className
 )}
 {...props}>
 {children}
 {!hideClose && (
 <DialogPrimitive.Close
 className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity duration-micro ease-out-quart hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
 <X className="h-4 w-4" />
 <span className="sr-only">Close</span>
 </DialogPrimitive.Close>
 )}
 </DialogPrimitive.Content>
 </DialogPortal>
 )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
 className,
 ...props
}) => (
 <div
 className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
 {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
 className,
 ...props
}) => (
 <div
 className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
 {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
 <DialogPrimitive.Title
 ref={ref}
 className={cn("text-lg font-semibold leading-none tracking-tight", className)}
 {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
 <DialogPrimitive.Description
 ref={ref}
 className={cn("text-sm text-muted-foreground", className)}
 {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
 Dialog,
 DialogPortal,
 DialogOverlay,
 DialogTrigger,
 DialogClose,
 DialogContent,
 DialogHeader,
 DialogFooter,
 DialogTitle,
 DialogDescription,
}
