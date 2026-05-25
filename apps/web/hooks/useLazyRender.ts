"use client";

import { useEffect, useRef, useState } from "react";

type UseLazyRenderOptions = {
  rootMargin?: string;
  threshold?: number;
};

export function useLazyRender(options?: UseLazyRenderOptions) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: options?.rootMargin ?? "140px",
        threshold: options?.threshold ?? 0.1
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.rootMargin, options?.threshold, visible]);

  return { ref, visible };
}
