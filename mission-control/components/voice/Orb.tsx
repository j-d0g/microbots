"use client";
import { useEffect, useRef } from "react";
import { audioLevel, useUI, type VoiceState } from "@/lib/client/ui-store";

const COLORS: Record<VoiceState, [number, number, number]> = {
  idle: [56, 225, 255],
  listening: [92, 242, 165],
  transcribing: [92, 242, 165],
  thinking: [167, 139, 250],
  speaking: [124, 243, 255],
};

export function Orb({ size = 132, tint }: { size?: number; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useUI((s) => s.voiceState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tintRef = useRef(tint);
  tintRef.current = tint;

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    let raf = 0;
    let col = [...COLORS.idle];
    const draw = (t: number) => {
      const s = stateRef.current;
      const target = tintRef.current && s === "speaking" ? hex(tintRef.current) : COLORS[s];
      col = col.map((v, i) => v + (target[i] - v) * 0.08);
      const [r, gg, b] = col.map(Math.round);
      const rgba = (a: number) => `rgba(${r},${gg},${b},${a})`;
      const lvl = audioLevel.current;
      const breathe = s === "idle" ? 0.04 * Math.sin(t / 900) : 0;
      const cx = size / 2;
      const R = size * 0.22 * (1 + breathe + lvl * 0.45);
      g.clearRect(0, 0, size, size);

      const halo = g.createRadialGradient(cx, cx, R * 0.4, cx, cx, size / 2);
      halo.addColorStop(0, rgba(0.35 + lvl * 0.3));
      halo.addColorStop(1, rgba(0));
      g.fillStyle = halo;
      g.fillRect(0, 0, size, size);

      const core = g.createRadialGradient(cx - R * 0.3, cx - R * 0.3, R * 0.1, cx, cx, R);
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.35, rgba(0.95));
      core.addColorStop(1, rgba(0.15));
      g.fillStyle = core;
      g.beginPath();
      g.arc(cx, cx, R, 0, Math.PI * 2);
      g.fill();

      const spin = s === "thinking" ? t / 260 : s === "listening" ? t / 900 : t / 2600;
      g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const rr = size * (0.33 + k * 0.06) + lvl * 6 * (k + 1);
        g.strokeStyle = rgba(0.5 - k * 0.13);
        g.lineWidth = k === 0 ? 1.6 : 1;
        const segs = 3 + k;
        for (let i = 0; i < segs; i++) {
          const a0 = spin * (k % 2 ? -1 : 1) * (1 + k * 0.3) + (i * Math.PI * 2) / segs;
          g.beginPath();
          g.arc(cx, cx, rr, a0, a0 + (Math.PI * 2) / segs * 0.55);
          g.stroke();
        }
      }
      g.strokeStyle = rgba(0.12);
      g.lineWidth = 1;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2 + spin * 0.2;
        const r1 = size * 0.47, r2 = r1 - (i % 4 === 0 ? 5 : 2.5);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a) * r2, cx + Math.sin(a) * r2);
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

function hex(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
