import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { MintRenderer } from './mint/mintRenderer';
import { tauriBridge } from './native/tauriBridge';
import { carlottaCompanionController } from './mint/carlottaCompanionController';
import { carlottaGestureController } from './mint/carlottaGestureController';

// Companion-only world-space offset for Carlotta's actual 3D model.
// This moves the model inside the scene without moving the native window,
// renderer surface, or companion controls.
const COMPANION_MODEL_Y_OFFSET = -0.7;

/** Standalone UI used only by the real Tauri desktop companion window. */
export default function CompanionApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MintRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('jumping');

  useEffect(() => {
    // A transparent Tauri/WebView2 companion must also have a transparent
    // document surface. Tailwind's normal page surface can otherwise leave
    // the native transparent window looking like a solid white rectangle.
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlBackground = html.style.background;
    const previousBodyBackground = body.style.background;
    html.style.background = 'transparent';
    body.style.background = 'transparent';

    if (!hostRef.current) return;
    const renderer = new MintRenderer();
    rendererRef.current = renderer;
    renderer.setCompanionMode(true);
    renderer.mount(hostRef.current, 'low');

    let startAttempts = 0;
    const startTimer = window.setInterval(() => {
      startAttempts += 1;
      if (!rendererRef.current) return;
      if (rendererRef.current.getIsVrmLoaded()) {
        // Move Carlotta's actual loaded 3D scene downward in world space.
        // The native companion window and its renderer surface stay fixed.
        const modelGroup = (renderer as unknown as {
          activeModelGroup: { position: { y: number } } | null;
        }).activeModelGroup;
        if (modelGroup) modelGroup.position.y = COMPANION_MODEL_Y_OFFSET;

        // The normal app has a startup Bow. The companion has its own
        // arrival animation, so cancel that upper-body gesture here.
        carlottaGestureController.cancel();
        renderer.setCompanionMode(true);
        carlottaCompanionController.enter();
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
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(startTimer);
      window.clearInterval(phaseTimer);
      window.removeEventListener('resize', onResize);
      renderer.unmount();
      rendererRef.current = null;
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
      <div
        ref={hostRef}
        className="absolute inset-0 bg-transparent"
      />
      <div className="absolute top-2 right-2 z-20 flex gap-1.5">
        <button
          type="button"
          onClick={restore}
          title="Return to ZOYA"
          className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/80 hover:text-white hover:bg-black/75 flex items-center justify-center shadow-lg"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={restore}
          title="Return to ZOYA"
          className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/80 hover:text-white hover:bg-black/75 flex items-center justify-center shadow-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-black/45 backdrop-blur-md border border-white/10 text-[10px] text-white/70 whitespace-nowrap">
        {ready ? (phase === 'sitting' ? 'ZOYA is sitting nearby' : phase === 'standing' ? 'ZOYA is returning…' : 'ZOYA is arriving…') : 'Starting companion…'}
      </div>
    </div>
  );
}
