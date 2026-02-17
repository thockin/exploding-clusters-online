// Copyright 2025 Tim Hockin

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import { GameManager } from './src/gameManager';
import { config, printHelp } from './src/config';

if (process.argv.includes('--help')) {
  printHelp();
  process.exit(0);
}

const dev = config.isDev;
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = config.port;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    if (config.enableInfoz && (pathname === '/infoz' || pathname?.startsWith('/infoz/game/'))) {
        gameManager.handleInfozRequest(req, res);
        return;
    }

    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer);
  const gameManager = new GameManager(io);

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
