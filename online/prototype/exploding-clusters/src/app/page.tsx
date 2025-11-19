'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Container, Row, Col, Card } from 'react-bootstrap';

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dbgQuery, setDbgQuery] = useState('');

  useEffect(() => {
    const dbg = searchParams.get('dbg');
    if (dbg === '1') {
      setDbgQuery('?dbg=1');
    }
  }, [searchParams]);

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="6">
          <Card className="text-center">
            <Card.Header as="h2">Exploding Clusters</Card.Header>
            <Card.Body>
              <Button variant="primary" size="lg" className="mb-3 w-100" onClick={() => router.push(`/create${dbgQuery}`)}>
                Create a new game
              </Button>
              <Button variant="success" size="lg" className="mb-3 w-100" onClick={() => router.push(`/join${dbgQuery}`)}>
                Join a game
              </Button>
              <Button variant="info" size="lg" className="w-100" onClick={() => router.push('/watch')}>
                Watch a game
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}