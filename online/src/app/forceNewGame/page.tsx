'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '../contexts/SocketContext';

export default function ForceNewGame() {
  const router = useRouter();
  const { resetState } = useSocket();

  useEffect(() => {
    resetState();
    router.replace('/');
  }, [resetState, router]);

  return (
    <div className="d-flex justify-content-center align-items-center vh-100">
      <h2>Resetting game state...</h2>
    </div>
  );
}
