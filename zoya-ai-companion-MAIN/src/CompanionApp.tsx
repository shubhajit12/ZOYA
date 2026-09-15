import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { MintRenderer } from './mint/mintRenderer';
import { tauriBridge } from './native/tauriBridge';
import { carlottaCompanionController } from './mint/carlottaCompanionController';
import { carlottaGestureController } from './mint/carlottaGestureController';

/** Standalone UI used only by the real Tauri desktop companion window. */
export default function CompanionApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MintRenderer | null>(null);
  const readyRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState('jumping');

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlBackground = html.style.background;
    const previousBodyBackground = body.style.background;
    html.style.background = 'transparent';
    body.style.background = 'transparent';

    if (!hostRef.current) return;
    const host = hostRef.current;
    const renderer = new MintRenderer();
    rendererRef.current = renderer;
    renderer.setCompanionMode(true);
    renderer.mount(host, 'low');

    let startAttempts = 0;
    const startTimer = window.setInterval(() => {
      startAttempts += 1;
      if (!rendererRef.current) return;
      if (rendererRef.current.getIsVrmLoaded()) {
        carlottaGestureController.cancel();
        renderer.setCompanionMode(true);
        carlottaCompanionController.enter();
        readyRef.current = true;
        setReady(true);
        window.clearInterval(startTimer);
      } else if (startAttempts >= 100) {
        window.clearInterval(startTimer);
      }
    }, 100);

    const phaseTimer = window.setInterval(() => {
      setPhase(carlottaCompanionController.getPhase());
    }, 120);

    const onResize = () => {
      if (!hostRef.current) return;
      renderer.resize(hostRef.current.clientWidth, hostRef.current.clientHeight);
    };

    const runNativeDrag = async () => {
      if (dragStartedRef.current || draggingRef.current) return;

      dragStartedRef.current = true;
      draggingRef.current = true;
      setDragging(true);

      try {
        await tauriBridge.startCompanionDrag();
        await tauriBridge.finishCompanionDrag();
      } catch (error) {
        console.error('[ZOYA] Companion drag failed:', error);
      } finally {
        draggingRef.current = false;
        dragStartedRef.current = false;
        pointerStartRef.current = null;
        setDragging(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !readyRef.current || draggingRef.current) return;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
    };

    const onPointerMove = (event: PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start || draggingRef.current || !readyRef.current) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const distanceSquared = dx * dx + dy * dy;

      // Do not turn an ordinary click into a native window drag. Start the
      // system drag only after the pointer has moved a few pixels.
      if (distanceSquared >= 64) {
        event.preventDefault();
        void runNativeDrag();
      }
    };

    const onPointerUp = () => {
      if (!draggingRef.current) {
        pointerStartRef.current = null;
      }
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(startTimer);
      window.clearInterval(phaseTimer);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
      renderer.unmount();
      rendererRef.current = null;
      readyRef.current = false;
      draggingRef.current = false;
      pointerStartRef.current = null;
      dragStartedRef.current = false;
      html.style.background = previousHtmlBackground;
      body.style.background = previousBodyBackground;
    };
  }, []);

  const restore = async () => {
    rendererRef.current?.exitCompanionMotion();
    await tauriBridge.exitCompanion();
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-transparent select-none">
      <div ref={hostRef} className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[220px] h-[350px] bg-transparent cursor-grab active:cursor-grabbing" />
      <div className="absolute top-2 right-2 z-20 flex gap-1.5">
        <button type="button" onClick={restore} title="Return to ZOYA" className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/80 hover:text-white hover:bg-black/75 flex items-center justify-center shadow-lg">
          <RotateCcw className="w-4 h-4" />
        </button>
        <button type="button" onClick={restore} title="Return to ZOYA" className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/80 hover:text-white hover:bg-black/75 flex items-center justify-center shadow-lg">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-black/45 backdrop-blur-md border border-white/10 text-[10px] text-white/70 whitespace-nowrap">
        {dragging ? 'Drag ZOYA onto a window' : ready ? (phase === 'sitting' ? 'Drag ZOYA onto a window' : phase === 'standing' ? 'ZOYA is returning…' : 'ZOYA is arriving…') : 'Starting companion…'}
      </div>
    </div>
  );
}
