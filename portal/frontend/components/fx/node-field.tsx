'use client';

import { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/**
 * Lightweight canvas 2D node network. Fixed behind the shell, no pointer events.
 * Mouse lightly repels nearby nodes. Pauses when the tab is hidden.
 */
export function NodeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const glow = glowRef.current;
    if (!canvasEl) return;
    const context = canvasEl.getContext('2d', { alpha: true });
    if (!context) return;
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = context;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: -9999, y: -9999, active: false };
    const particles: Particle[] = [];
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let running = true;
    let linkDist = 128;

    function countForArea(area: number): number {
      const cabinet = Boolean(document.querySelector('.dashboard-shell'));
      const cap = cabinet ? 42 : 72;
      const base = cabinet ? 28000 : 20000;
      return Math.max(22, Math.min(cap, Math.round(area / base)));
    }

    function seed() {
      particles.length = 0;
      const n = countForArea(w * h);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.28,
          vy: (Math.random() - 0.5) * 0.28,
        });
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      linkDist = Math.min(150, Math.max(96, Math.hypot(w, h) * 0.055));
      if (particles.length === 0) seed();
      else if (Math.abs(particles.length - countForArea(w * h)) > 12) seed();
    }

    function drawStatic() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(61, 139, 253, 0.28)';
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);

      const mx = mouse.x;
      const my = mouse.y;
      const repelR = 130;
      const repelR2 = repelR * repelR;

      for (const p of particles) {
        if (mouse.active) {
          const dx = p.x - mx;
          const dy = p.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 < repelR2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((repelR - d) / repelR) * 0.045;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.vx += (Math.random() - 0.5) * 0.006;
        p.vy += (Math.random() - 0.5) * 0.006;
        p.vx *= 0.992;
        p.vy *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        else if (p.y > h + 20) p.y = -20;
      }

      const link2 = linkDist * linkDist;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > link2) continue;
          const t = 1 - d2 / link2;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(61, 139, 253, ${0.055 + t * 0.22})`;
          ctx.lineWidth = 0.7 + t * 0.6;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(126, 179, 255, 0.14)';
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(210, 228, 255, 0.85)';
        ctx.arc(p.x, p.y, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    }

    function onMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      if (glow) {
        glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
        glow.style.opacity = '1';
      }
    }
    function onLeave() {
      mouse.active = false;
      if (glow) glow.style.opacity = '0';
    }
    function onVis() {
      running = !document.hidden && !reduce;
      if (running) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
      }
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    document.addEventListener('visibilitychange', onVis);

    if (reduce) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <>
      <div ref={glowRef} className="cursor-glow" aria-hidden />
      <canvas ref={canvasRef} className="node-field" aria-hidden />
    </>
  );
}
