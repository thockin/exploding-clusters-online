# Exploding Clusters

An infrastructure-themed card game inspired by "Exploding Kittens", played in
the browser with friends.

Just like the original game, players take turns playing and drawing cards until
someone draws an **EXPLODING CLUSTER**. If they don't have a **DEBUG** card to
defuse it, they explode and are out of the game. The last player with a
functional cluster wins!

## How to Play

1.  **Start a Game**: One player creates a game and shares the game code with
    friends.
2.  **Join a Game**: Other players use a game code to join a game.
3.  **Survive**: Play cards (Attack, Skip, Shuffle, See the Future, etc.) to
    avoid drawing an EXPLODING CLUSTER.

## Running Locally

To run the game on your local machine:

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Start the development server**:
    ```bash
    npm run dev
    ```

3.  **Open the game**:
    Visit [http://localhost:3000](http://localhost:3000) in your browser.

## Developer Mode

You can run the server in developer mode, which enables extra debugging tools
(seeing the deck, forcing card draws, deterministic shuffling):

```bash
DEVMODE=1 npm run dev
```

## Testing

To run the full test suite (unit tests and browser tests via Playwright):

```bash
make test
```

## Contributions are welcome!

I freely admit that I leaned on AI tools to build this.  That was part of the
experiment - low risk, high reward.  I accept that it probably generated
terrible code, and I am willing to accept PRs to make it better.  Before this
project, I did not know ANY of these technologies.  Now I can at least look at
them and not be lost.

Built with:
*   Node.js
*   Next.js
*   React
*   Socket.io
*   TypeScript
