"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// A quick, auto-cycling look at the product for someone who isn't
// going to scroll through seven screenshots or click into the demo —
// the "show them in five seconds" version of this page. The full
// static gallery below stays for whoever wants to actually look at
// each one.
//
// PAUSES ON HOVER/FOCUS, AND NEVER AUTO-ADVANCES UNDER REDUCED MOTION —
// same discipline as SharpsFillDiagram.tsx's animation: a person who
// has asked their OS to cut motion gets a single still frame, not a
// slower version of the same motion.

export interface CarouselShot {
  src: string;
  alt: string;
  caption: string;
}

const INTERVAL_MS = 3400;

export default function ProductTourCarousel({ shots }: { shots: CarouselShot[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Read once, synchronously, at first render — an effect exists to
  // SUBSCRIBE to a later change, never to set the state an initializer
  // could already answer.
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % shots.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, [paused, reducedMotion, shots.length]);

  return (
    <div
      className="tour-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="tour-carousel-frame">
        {shots.map((shot, i) => (
          <div
            key={shot.src}
            className={`tour-carousel-slide${i === index ? " tour-carousel-slide-active" : ""}`}
            aria-hidden={i !== index}
          >
            <Image src={shot.src} alt={shot.alt} fill sizes="(max-width: 800px) 100vw, 760px" priority={i === 0} />
          </div>
        ))}
      </div>

      <p className="tour-carousel-caption">{shots[index].caption}</p>

      <div className="tour-carousel-dots" role="tablist" aria-label="Screenshots">
        {shots.map((shot, i) => (
          <button
            key={shot.src}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Show screenshot ${i + 1} of ${shots.length}`}
            className={`tour-carousel-dot${i === index ? " tour-carousel-dot-active" : ""}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
