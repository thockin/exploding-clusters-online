import { createServer } from 'http';
import { parse } from 'url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const next = require('next');
import { Server } from 'socket.io';
import { GameManager } from './src/gameManager';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    if (pathname === '/infoz' || pathname?.startsWith('/infoz/game/')) {
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
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});