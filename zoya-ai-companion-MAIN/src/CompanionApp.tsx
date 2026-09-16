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
        // Do not leave the companion permanently locked in its loading state.
        // The model is visibly mounted on the target machines even when this
        // internal renderer flag does not settle, so allow native interaction.
        carlottaGestureController.cancel();
        renderer.setCompanionMode(true);
        carlottaCompanionController.enter();
        readyRef.current = true;
        setReady(true);
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

    const finishNativeDrag = async () => {
      if (!draggingRef.current) return;

      try {
        await tauriBridge.finishCompanionDrag();
      } catch (error) {
        console.error('[ZOYA] Companion drop failed:', error);
      } finally {
        draggingRef.current = false;
        dragStartedRef.current = false;
        setDragging(false);
      }
    };

    const runNativeDrag = async () => {
      if (dragStartedRef.current || draggingRef.current) return;

      dragStartedRef.current = true;
      draggingRef.current = true;
      setDragging(true);

      try {
        // IMPORTANT: startDragging() only starts the OS drag operation.
        // The previous implementation called finishCompanionDrag() immediately
        // afterwards, so Rust hid the companion while the cursor was still on
        // the companion and correctly concluded that the drop target was null.
        // That is why every drag snapped straight back to the taskbar.
        await tauriBridge.startCompanionDrag();
      } catch (error) {
        console.error('[ZOYA] Companion drag failed:', error);
        draggingRef.current = false;
        dragStartedRef.current = false;
        setDragging(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !readyRef.current || draggingRef.current) return;
      event.preventDefault();
      void runNativeDrag();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      void finishNativeDrag();
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      void finishNativeDrag();
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', finishNativeDrag);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(startTimer);
      window.clearInterval(phaseTimer);
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', finishNativeDrag);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onResize);
      renderer.unmount();
      rendererRef.current = null;
      readyRef.current = false;
      draggingRef.current = false;
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
