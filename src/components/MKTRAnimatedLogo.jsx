// Brand splash / loading screen used by main.jsx (app boot) and GoogleCallback.jsx
// (OAuth round-trip). The terminal-mark loader lives in TypingLoader so the two
// legacy entry points share a single implementation — adjust the animation there.
export { default } from '@/components/ui/TypingLoader';
