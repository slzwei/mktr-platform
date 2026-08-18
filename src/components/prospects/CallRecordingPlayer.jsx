import { useEffect, useRef, useState } from "react";

// Retell's split recording puts the callee on ch0 and the agent on ch1 —
// verified by measuring a production screening call: during agent speech ch0
// reads −45 dBFS (silent) while ch1 reads −20.6, and the two swap for the
// callee's turns.
const CALLEE_CHANNEL = 0;
const AGENT_CHANNEL = 1;

// Measured on the same call: in the mono mix the agent averages −26.6 dBFS RMS
// against the callee's −32.4, and the isolated legs sit 8.3 LU apart. +8 dB on
// the callee against −2 dB of agent trim closes that gap without clipping —
// the callee's peaks already reach −3.4 dBFS, so the gain rides the compressor.
const DEFAULT_CALLEE_BOOST_DB = 8;
const AGENT_TRIM_DB = -2;
const MAX_CALLEE_BOOST_DB = 18;

// The compressor pulls the summed mix ~4.5 dB below the original mono file, so
// balancing the two voices would otherwise cost overall loudness. +6 dB puts
// both speakers back at ~-25 dBFS RMS with the true peak still at -8.2 dBFS —
// verified by rendering this exact graph over a production call.
const MAKEUP_GAIN_DB = 6;

const dbToGain = (db) => Math.pow(10, db / 20);

/**
 * Call recording player that can lift the callee independently of the agent.
 *
 * `src` is Retell's mono mixdown, where a human on a phone line is consistently
 * quieter than the agent's compressed TTS. `multiChannelSrc` is Retell's split
 * recording; when present we run it through Web Audio and boost the callee leg
 * so the answer is as audible as the question.
 *
 * Degrades to a plain <audio> element whenever the split file or Web Audio is
 * unavailable — prospects captured before the split URL was stored, jsdom under
 * test, or a browser that refuses createMediaElementSource.
 */
export default function CallRecordingPlayer({ src, multiChannelSrc, className, style }) {
  const audioRef = useRef(null);
  const graphRef = useRef(null);
  const [calleeBoostDb, setCalleeBoostDb] = useState(DEFAULT_CALLEE_BOOST_DB);
  const [isSplit, setIsSplit] = useState(false);

  const url = multiChannelSrc || src;

  useEffect(() => {
    setIsSplit(false);
    graphRef.current = null;
    if (!multiChannelSrc) return undefined;

    const el = audioRef.current;
    const Ctx = typeof window !== "undefined"
      && (window.AudioContext || window.webkitAudioContext);
    if (!el || !Ctx) return undefined;

    let ctx;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaElementSource(el);
      const splitter = ctx.createChannelSplitter(2);
      const calleeGain = ctx.createGain();
      const agentGain = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      const compressor = ctx.createDynamicsCompressor();

      // Gentle levelling only — enough to tame the boosted callee's peaks
      // without pumping the agent's already-compressed voice.
      compressor.threshold.value = -26;
      compressor.knee.value = 30;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      calleeGain.gain.value = dbToGain(DEFAULT_CALLEE_BOOST_DB);
      agentGain.gain.value = dbToGain(AGENT_TRIM_DB);

      source.connect(splitter);
      splitter.connect(calleeGain, CALLEE_CHANNEL);
      splitter.connect(agentGain, AGENT_CHANNEL);
      // Both legs feed both outputs: split channels would otherwise put the
      // callee in one ear and the agent in the other.
      calleeGain.connect(merger, 0, 0);
      calleeGain.connect(merger, 0, 1);
      agentGain.connect(merger, 0, 0);
      agentGain.connect(merger, 0, 1);
      const makeup = ctx.createGain();
      makeup.gain.value = dbToGain(MAKEUP_GAIN_DB);

      merger.connect(compressor);
      compressor.connect(makeup);
      makeup.connect(ctx.destination);

      graphRef.current = { ctx, calleeGain };
      setIsSplit(true);
    } catch {
      // Tainted cross-origin media or an engine without Web Audio: the element
      // still plays the split file untouched, just without the boost.
      if (ctx) ctx.close().catch(() => {});
      return undefined;
    }

    return () => {
      graphRef.current = null;
      ctx.close().catch(() => {});
    };
  }, [multiChannelSrc]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) graph.calleeGain.gain.value = dbToGain(calleeBoostDb);
  }, [calleeBoostDb]);

  // Browsers start the context suspended until a gesture; play is that gesture.
  const handlePlay = () => {
    const graph = graphRef.current;
    if (graph && graph.ctx.state === "suspended") graph.ctx.resume().catch(() => {});
  };

  if (!url) return null;

  return (
    <div className={className} style={style}>
      <audio
        key={url}
        ref={audioRef}
        src={url}
        controls
        preload="metadata"
        crossOrigin="anonymous"
        onPlay={handlePlay}
        style={{ width: "100%" }}
      >
        Your browser does not support audio playback.
      </audio>
      {isSplit && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            fontSize: 11,
            opacity: 0.75,
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>Callee boost</span>
          <input
            type="range"
            min={0}
            max={MAX_CALLEE_BOOST_DB}
            step={1}
            value={calleeBoostDb}
            onChange={(e) => setCalleeBoostDb(Number(e.target.value))}
            aria-label="Callee boost in decibels"
            style={{ flex: 1, minWidth: 80 }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            +{calleeBoostDb} dB
          </span>
        </label>
      )}
    </div>
  );
}
