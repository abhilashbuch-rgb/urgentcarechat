"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// The "one at a time" half of the product tour, rebuilt from a flat
// figure/figcaption list into something that doesn't read as seven
// slides in a deck: each screenshot sits in a browser-chrome frame
// (real depth via a strong shadow, not a hairline border on a white
// card that blended into the page), carries its own numbered bubble,
// and fades up into place as it's scrolled to — reinforced by a
// sticky rail of the same numbered bubbles down the side, which fills
// in as you go and jumps to a screen on click.
//
// REVEALED ONCE, NEVER HIDDEN AGAIN. The IntersectionObserver callback
// only ever ADDS tour-step-visible, never removes it — scrolling back
// up over an already-seen screen should not make it disappear and
// replay. That would read as a bug, not as polish.
//
// NO ANIMATION UNDER REDUCED MOTION, same discipline as
// ProductTourCarousel.tsx and SharpsFillDiagram.tsx: a person who has
// asked their OS to cut motion gets every screen already in place,
// not a slower version of the same fade.

export interface TourStep {
  src: string;
  alt: string;
  caption: string;
}

export default function ProductTourSteps({ steps }: { steps: TourStep[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = stepRefs.current.indexOf(entry.target as HTMLElement);
          if (idx === -1) continue;
          if (entry.isIntersecting) {
            entry.target.classList.add("tour-step-visible");
            setActiveIndex(idx);
          }
        }
      },
      { threshold: 0.45 }
    );
    for (const el of stepRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const jumpTo = (i: number) => {
    stepRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="tour-steps">
      <div className="tour-steps-rail" aria-label="Jump to a screen">
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`tour-steps-dot${i === activeIndex ? " tour-steps-dot-active" : ""}`}
            onClick={() => jumpTo(i)}
            aria-label={`Screen ${i + 1} of ${steps.length}`}
            aria-current={i === activeIndex}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className="tour-steps-list">
        {steps.map((shot, i) => (
          <figure
            key={shot.src}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            className="tour-step"
          >
            <span className="tour-step-number" aria-hidden="true">
              {i + 1}
            </span>
            <div className="tour-step-frame">
              <div className="tour-step-chrome" aria-hidden="true">
                <span className="tour-step-chrome-dot tour-step-chrome-dot-red" />
                <span className="tour-step-chrome-dot tour-step-chrome-dot-yellow" />
                <span className="tour-step-chrome-dot tour-step-chrome-dot-green" />
              </div>
              <Image
                src={shot.src}
                alt={shot.alt}
                width={2400}
                height={1800}
                sizes="(max-width: 800px) 100vw, 720px"
                priority={i === 0}
              />
            </div>
            <figcaption>{shot.caption}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
