"use client";

import Image from "next/image";
import type { AnimationEvent } from "react";
import { PlayIcon } from "./icons";

type DemoCardProps = {
  onEntranceEnd: (event: AnimationEvent<HTMLElement>) => void;
};

export function DemoCard({ onEntranceEnd }: DemoCardProps) {
  return (
    <article className="demo-card" onAnimationEnd={onEntranceEnd}>
      <div className="demo-visual">
        <Image
          className="demo-thumb"
          src="/assets/watch-demo-thumbnail.png"
          alt="Abstract red and blue smoke"
          fill
          sizes="215px"
          priority
        />
        <button className="play" type="button" aria-label="Play demo">
          <PlayIcon />
        </button>
      </div>

      <button className="watch-button" type="button">
        <span>Watch Demo</span>
      </button>
    </article>
  );
}
