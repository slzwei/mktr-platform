import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Camera QR scanner for the Redemptions console. Scanning is IDENTIFICATION
 * only — it decodes a value and hands it to `onDetect`; the caller resolves
 * what it is (pass vs voucher) and always confirms before any irreversible
 * action. Never auto-fires.
 *
 * getUserMedia needs HTTPS (ops.redeem.sg qualifies). The <video> stays mounted
 * for the whole open lifetime so its ref is stable across permission/error
 * re-renders; error/empty states overlay it. Camera tracks are released on
 * close, unmount, and tab-hide.
 */
export default function QrScannerDialog({
  open,
  onOpenChange,
  onDetect,
  onPasteFallback,
  title = 'Scan QR',
  hint = "Point the camera at the customer's reward QR",
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const streamRef = useRef(null);
  const lockedRef = useRef(false); // true once a code is found — stops the loop
  const lastDecodeRef = useRef(0);
  // Latest onDetect held in a ref so its identity changing never restarts the
  // camera (the start-effect depends on `tick`, which must stay stable).
  const onDetectRef = useRef(onDetect);
  // Live `open` for the async getUserMedia guard (dialog may close mid-request).
  const openRef = useRef(open);
  const [phase, setPhase] = useState('starting'); // starting | scanning | denied | nocamera | error
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);
  useEffect(() => { openRef.current = open; }, [open]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchable(false);
  }, []);

  const tick = useCallback(() => {
    rafRef.current = 0;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || lockedRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastDecodeRef.current >= 100) { // throttle decode to ~10fps
        lastDecodeRef.current = now;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw && vh) {
          // Center-square crop, capped at 640px — QRs are held centered, and a
          // smaller frame keeps jsQR fast enough for a live loop.
          const side = Math.min(vw, vh);
          const cap = Math.min(side, 640);
          canvas.width = cap;
          canvas.height = cap;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, cap, cap);
          const img = ctx.getImageData(0, 0, cap, cap);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            lockedRef.current = true;
            onDetectRef.current(code.data.trim());
            return; // parent handles/closes; do not reschedule
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startCamera = useCallback(async () => {
    lockedRef.current = false;
    lastDecodeRef.current = 0;
    setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia) { setPhase('nocamera'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      // Bail if the dialog closed or the tab hid while the prompt was open —
      // otherwise the granted stream leaks (camera light stays on).
      if (!openRef.current || document.hidden) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.();
      setTorchable(Boolean(caps && 'torch' in caps && caps.torch));
      setPhase('scanning');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setPhase('denied');
      else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') setPhase('nocamera');
      else setPhase('error');
    }
  }, [tick]);

  // Start on open, fully release on close/unmount.
  useEffect(() => {
    if (!open) return undefined;
    startCamera();
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  // Fully release the camera while the tab is hidden (not just the decode loop
  // — the indicator light must go off); re-acquire on return. (Codex review.)
  useEffect(() => {
    if (!open) return undefined;
    const onVis = () => { if (document.hidden) stopCamera(); else startCamera(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open, startCamera, stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch { /* torch not applicable — ignore */ }
  };

  const errorText = {
    denied: { title: 'Camera access is off', body: 'Allow the camera in your browser’s site settings, or paste the code instead.' },
    nocamera: { title: 'No camera found', body: 'Use a device with a camera, or paste the code instead.' },
    error: { title: 'Couldn’t start the camera', body: 'Close and try again, or paste the code instead.' },
  }[phase];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>

        <div className="relative w-full aspect-square overflow-hidden rounded-xl bg-black">
          {/* Always mounted so the ref is stable; hidden black frame under errors. */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            aria-label="Camera preview"
          />
          {phase === 'scanning' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="w-2/3 h-2/3 rounded-lg"
                style={{ boxShadow: '0 0 0 3px rgba(255,255,255,.92), 0 0 0 9999px rgba(0,0,0,.38)' }}
              />
            </div>
          )}
          {phase === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-white/90 text-sm">
              Starting camera…
            </div>
          )}
          {errorText && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center bg-black/70">
              <div>
                <p className="text-white font-semibold m-0">{errorText.title}</p>
                <p className="text-white/70 text-sm mt-1 mb-0">{errorText.body}</p>
              </div>
            </div>
          )}
          {torchable && phase === 'scanning' && (
            <button
              type="button"
              onClick={toggleTorch}
              className="absolute bottom-2 right-2 rounded-full bg-black/60 text-white text-xs px-3 py-1.5"
            >
              {torchOn ? 'Torch off' : 'Torch'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {onPasteFallback && (
            <Button
              variant="ghost"
              onClick={() => { onOpenChange(false); onPasteFallback(); }}
            >
              Paste code instead
            </Button>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
