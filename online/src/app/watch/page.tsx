// Copyright 2025 Tim Hockin

'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSocket } from '../contexts/SocketContext';
import { Container, Button } from 'react-bootstrap';

export default function WatchGamePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { watchGame, resetState } = useSocket();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try to get gameCode from query param first (from rewrite), then from pathname
    let urlGameCode = searchParams.get('code');

    // If not in query params, parse from pathname: /watch/XXXXX
    if (!urlGameCode && pathname) {
      const pathParts = pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && pathParts[0] === 'watch' && pathParts[1]) {
        urlGameCode = pathParts[1];
      }
    }
    if (!urlGameCode) {
      router.replace('/');
      return;
    }

    // Clear all client state first
    resetState();

    // Automatically join as spectator
    const joinAsSpectator = async () => {
      try {
        setIsLoading(true);
        // Wait a moment for state to reset
        await new Promise(resolve => setTimeout(resolve, 100));

        const response = await watchGame(urlGameCode.toUpperCase());
        if (response.success && response.gameCode) {
          router.replace(`/observer`);
        } else {
          setError(response.error || 'Failed to watch game.');
          setIsLoading(false);
        }
      } catch (err) {
        setError('An error occurred while trying to watch the game.' + err);
        setIsLoading(false);
      }
    };

    joinAsSpectator();
  }, [router, pathname, searchParams, watchGame, resetState]);

  if (isLoading) {
    return <Container className="mt-5 text-center"><h2>Joining as spectator...</h2></Container>;
  }

  if (error) {
    return (
      <Container className="mt-5 text-center">
        <h2>Error</h2>
        <p>{error}</p>
        <Button onClick={() => router.push('/')}>OK</Button>
      </Container>
    );
  }

  return null;
}

