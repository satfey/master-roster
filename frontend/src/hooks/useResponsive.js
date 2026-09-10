import { useEffect, useState } from 'react';

export const BREAKPOINTS = { mobile: 768, desktop: 1200 };

const resolve = (width) => {
  if (width < BREAKPOINTS.mobile) return 'mobile';
  if (width < BREAKPOINTS.desktop) return 'tablet';
  return 'desktop';
};

/** Returns 'mobile' | 'tablet' | 'desktop' and keeps it in sync with resize. */
export function useResponsive() {
  const [device, setDevice] = useState(() =>
    typeof window === 'undefined' ? 'mobile' : resolve(window.innerWidth)
  );

  useEffect(() => {
    let frame = null;
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDevice(resolve(window.innerWidth)));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return {
    device,
    isMobile: device === 'mobile',
    isTablet: device === 'tablet',
    isDesktop: device === 'desktop'
  };
}
