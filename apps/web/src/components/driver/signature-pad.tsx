'use client';

/**
 * Hand-rolled signature pad. ~90 lines, supports touch + mouse, exports
 * as a PNG blob via canvas.toBlob. We didn't pull in react-signature-canvas
 * because the dep adds ~25KB gzipped for one screen.
 *
 * The canvas resizes to its container width on mount (CSS pixels) but
 * draws at devicePixelRatio so signatures stay crisp on retina screens.
 */
import { useEffect, useImperativeHandle, useRef } from 'react';
import * as React from 'react';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
}

interface Props {
  height?: number;
  /** Stroke color in CSS form. */
  color?: string;
  /** Background fill drawn before each clear, so the exported PNG isn't transparent. */
  background?: string;
}

export const SignaturePad = React.forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height = 200, color = '#FFFFFF', background = '#1A1E2A' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.offsetWidth;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cssWidth, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }, [height, color, background]);

  function coords(ev: PointerEvent | React.PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev: React.PointerEvent<HTMLCanvasElement>): void {
    ev.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(ev.pointerId);
    drawingRef.current = true;
    lastRef.current = coords(ev);
  }
  function onPointerMove(ev: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return;
    const point = coords(ev);
    const last = lastRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !point || !last) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastRef.current = point;
    dirtyRef.current = true;
  }
  function onPointerUp(): void {
    drawingRef.current = false;
    lastRef.current = null;
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      dirtyRef.current = false;
    },
    isEmpty: () => !dirtyRef.current,
    toBlob: () =>
      new Promise<Blob | null>((resolve) => {
        const c = canvasRef.current;
        if (!c) {
          resolve(null);
          return;
        }
        c.toBlob((b) => resolve(b), 'image/png');
      }),
  }));

  return (
    <canvas
      ref={canvasRef}
      className="block w-full touch-none rounded-[10px] border border-divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  );
});
