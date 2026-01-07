// Copyright 2025 Tim Hockin

'use client';

import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSocket } from '../contexts/SocketContext';

export default function JoinGamePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resetState } = useSocket();

  useEffect(() => {
    // Try to get gameCode from query param first (from rewrite), then from pathname
    let gameCode = searchParams.get('code');

    // If not in query params, parse from pathname: /join/XXXXX
    if (!gameCode && pathname) {
      const pathParts = pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && pathParts[0] === 'join' && pathParts[1]) {
        gameCode = pathParts[1];
      }
    }

    if (gameCode) {
      // Clear all client state
      resetState();
      // Redirect to main page with gameCode and action=join query params
      router.replace(`/?gameCode=${gameCode.toUpperCase()}&action=join`);
    } else {
      router.replace('/');
    }
  }, [router, pathname, searchParams, resetState]);

  return null;
}

