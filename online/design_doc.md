# Exploding Clusters Design Doc

## Objective

We are building an online web game. It is a version of the game "Exploding
Kittens", but our game is called "Exploding Clusters".

The first part of this doc will describe the game and how it should work.  The
second part will describe the implementation strategy.

As much as possible, we want to keep this design doc in sync with the code as
we evolve it.

## Part 1: The game

### The server and the client

This is a client-server web game. One player creates a game through the UI, and
other players can join or watch the game.  All game state is stored on the
server.  The client is a web app which runs in the browser and has minimal
state.  The server must communicate state and events to clients, including what
cards that player holds, what other players are in the game, whose turn it is,
and what cards are being played.  Clients can send commands to the server, such
as "play this card", "draw a card", or "reorder my hand".

The server can support many games at once.  Each game must be totally
independent from all other games.  Each game can support 2 to 5 players.  A
game cannot be started with less than 2 players, and if players leave the game
such that there are less than 2 players remaining, the game ends.

The server can listen on any port, and when a client connects to that port, it
knows to keep using the same port number for the rest of the game.

Each player gets a unique UUID, and the server tracks the UUID of the game
owner.  Only the game owner can start the game.

#### Game state

##### Per-game nonce

At startup, each game generates a random, 64 bit, unsigned nonce.  Every time
the game's state changes, such as a new player joining a lobby or a card being
played, a new nonce is chosen and all connected players get an event with an
updated nonce value.  The nonce helps to synchonize clients with the server.

The nonces are per-game, not global across all games on the server.

Nonces are always logged as their fixed-width, lower-case, hexadecimal representation,
without a "0x" prefix.  For example: "0123456789abcdef".

When a user joins the game, their session is associated with that game. If they
close their browser or navigate away, they are removed from the game.  If they
reload the page they can rejoin ONLY if the nonce they last received matches
the current nonce on the server.  If the nonce does not match, they can't
rejoin the game - they must start over.

A player leaving a game does not change the nonce.  If a player re-joins with
the correct name, UID, and nonce, the nonce should not be changed. If a net new
player joins, then the nonce must be changed.  If the game starts or cards are
played, the nonce must be changed. This should allow multiple players to leave
the game (e.g. refresh their browser) and rejoin as long as nothing else has
changed.

Any time the nonce changes, for any reason, all disconnected players must be
purged.

When a player tries to rejoin an existing game but is not allowed, show them a
dialog with a title like "Sorry!" and a message like "The game has changed
since you left. Rejoining it is not possible.". When they hit OK, take them to
the landing page.

When a player tries to rejoin a game that does not exist, take them back to the
landing page.

##### Disconnecting Players

When a player leaves the game, either by clicking the "leave game" button or by
navigating away, they should not appear in the player list, and all other
players should see a message like "{player} has left the game."  Their cards
are held in reserve until the nonce changes.  If the nonce changes, their cards
are removed from the game (neither in the draw-pile nor the discard-pile), but
the game should continue as long as there are at least 2 players.

When the next-to-last player leaves the game, either by clicking the button or
by navigating away, that is a "win by attrition" for the last remaining player.

When a player leaves the game while they are the target of a FAVOR card, the
player who played the FAVOR card gets a random card from the leaving player's
hand.

When a player leaves the game while they are the target of a pair of DEVELOPER cards, the
player who played the DEVELOPER cards gets tho choose a card (by index) from
the leaving player's hand.

If a player leaves the game during their turn, their turn is over and they are
not eligible to rejoin the game.
  * Any pending operations for that player are discarded.
  * If the player had to take multiple turns (e.g. they were the target of an
    ATTACK card), those are also discarded.
  * If the player has just drawn an EXPLODING CLUSTER card, it is automatically
    re-inserted at a random position in the draw-pile, face-down.
  * If the player has just drawn an UPGRADE CLUSTER card, it is automatically
    re-inserted at a random position in the draw-pile, face-up.
  * A message is sent to all players like "{player} has abandoned their turn,
    it's {nextplayer}'s turn.".
  * Play then continues with the next player's turn, causing the nonce to be
    updated.

When the game owner disconnects while the game is in the lobby, the server
should randomly choose another player to act as the owner.  The new owner
should be saved in the server and they should see the "Start the game" button.
They should also get a dialog with title "You are now the game owner" and
message "{previous owner} left the game, so you have been selected as the new
game owner. Congratulations on your promotion!". The original owner can rejoin
the game as a regular player, but they are no longer the owner.

When the last player leaves a game, all state for that game must be purged from
the server, whether there are spectators or not.  No new owner needs to be
chosen - the game is immediately over.

###### Example

Consider a game lobby with 4 connected players: A, B, C, and D.  The nonce is
currently 123. Player A is the game creator.

  * Player B navigates their browser away.
    - The last nonce they know is 123
    - Players A, C, and D remain
  * The server's game nonce remains 123.
  * The player list UI for players A, C, and D is updated to remove B.
  * Player C navigates their browser away.
    - The last nonce they know is 123
    - Players A and D remain
  * The server's game nonce remains 123.
  * The player list UI for players A and D is updated to remove C.
  * Player D navigates their browser away.
    - The last nonce they know is 123
    - Player A remains
  * The server's game nonce remains 123.
  * The player list UI for player A is updated to remove D.
  * Player B hits their browser's back button to rejoin the game.
    - They offer the last nonce they knew, which is 123
  * That matches the server's nonce, so B is allowed back in.
    - Players A and B are in the game
  * The player list UI for player A is updated to add B.
  * The server's game nonce remains 123.
  * Player C hits their browser's back button to rejoin the game.
    - They offer the last nonce they knew, which is 123
  * That matches the server's nonce, so C is allowed back in.
    - Players A, B, and C are in the game
  * The player list UI for players A and B is updated to add C.
  * The server's game nonce remains 123.
  * New player E joins the game.
    - Players A, B, C, and E are in the game
  * The server's game nonce changes to 456.
  * The player list UI for players A, B, and C is updated to add E.
  * Player D hits their browser's back button to rejoin the game.
    - They offer the last nonce they knew, which is 123
  * That DOES NOT match the server's nonce, so D is sent to the landing page.

Now player A starts the game.

  * The server's game nonce changes to 789.
  * All players (A, B, C, E) see the game screen.
  * It is player A's turn.
  * Player E navigates their browser away.
    - The last nonce they know is 789
    - Players A, B, and C remain
  * The server's game nonce remains 789.
  * Player E hits their browser's back button to rejoin the game.
    - They offer the last nonce they knew, which is 789
  * That matches the server's nonce, so E is allowed back in.
    - Players A, B, C, and E are in the game
  * The server's game nonce remains 789.
  * Player a plays an ATTACK card, targeting B.
    - It is now player B's turn, and they must take 2 turns.
    - The server's game nonce changes to abc.
  * Player B navigates their browser away.
  * Player B's turn is abandoned.
    - The ATTACK was cancelled
    - It is now player C's turn
    - The server's game nonce changes to def.
  * Player B hits their browser's back button to rejoin the game.
    - They offer the last nonce they knew, which is abc
    - That DOES NOT match the server's nonce, so B is sent to the landing page.

##### Cleanup

When a user leaves a game, their cards are held in reserve until the server
nonce changes.  Once it changes, those cards are removed from the game (neither
in the draw-pile nor the discard-pile), but the game should continue as long as
there are at least 2 players.  When the game ends or the last player leaves,
all state for that game must be purged from the server.

If the server is restarted, it should not retain any game state.

#### Extra URLs

The server should support a URL "/infoz" which produces an HTML page with a
link to each current game at "/infoz/game/{game-code}".  Clicking the link
takes you to the info page for a single game which shows:
  * The list of players and their hands (text only)
  * The current game nonce
  * The draw-pile (text only)
  * The discard-pile (text only)
  * The removed-pile (text only)
  * Whose turn it is
  * The timestamp this data was loaded

The infoz page is only for debugging and is not linked from anywhere in the
app.  It does not need to be dynamic - it can be a static snapshot of the game
state when the page wass loaded.

### Creating a game

To begin, a user connects to the server and hits the landing page.  They get a
choice:
  * "Start a new game"
  * "Join a game"
  * "Watch a game"

If they choose "Start a new game", we ask them their name, and then create a
new game instance on the server.  Each game gets a randomized "game code" which
is exacty 5 letters, alphabetic, no vowels, upper-case, and  does not contain
swear words. The player is then taken to the "lobby" screen.  They can see the
game code and share it with friends. This player is the game owner.

Player names must be validated to be safe (no HTML tags, no control characters,
etc) and no more than 32 characters long.

Clicking the "join game" button multiple times must only create one game.
Clicking repeatedly has no additional effect.

The lobby screen is the same for all players, except that the game owner sees
a "Start the game" button, while other players see a "Waiting for the game to
start" message. Both show a list of the joined players and how many people are
watching the game.

In the lobby screen for all players, including the game owner, there is a
"Leave the game" button.  Clicking this button first offers an "Are you sure you
want to leave the game" dialog, and (if the player confirms) clears all of the
client state including the game code and nonce, and takes the player back to
the landing page.  All that player's state is removed from the server, and all
other players in the lobby are notified and their player lists are updated.

### Joining a game

If the user chooses "Join a game", we ask them for a game code and their name.

Player names must be unique within a game, ignoring upper/lower case, and must
be validated to be safe (no HTML tags, no control characters, etc) and no more
than 32 characters long.

When they type in a game code, we try to join them to that game.  Before they
can join, we must:

  * Look for a game with that game code on the server.  If no such game code
    is found on the server, we tell the user "Game {code} does not exist", and
    leave them at the landing page.

  * If the game code is found, check if the game already has 5 users, and if so
    tell them "Sorry, that game is full", and leave them at the landing page.

  * If that player name is already used in the game, ignoring upper/lower
    case, ask them to pick a different name.

  * If they have a valid game code which exists on the server, and there is room
    for them, and their name is unique, add them to that game's "lobby" screen.

When a user is added to a game's lobby, all users in that game's lobby are
notified and their screens are updated to show the new player in the player
list.

### Watching a game

If the user chooses "Watch a game", we ask them for a game code.  Before they
can observer, we must look for a game with that game code on the server.  If no
such game code is found on the server, we tell the user "Game {code} does not
exist", and leave them at the landing page.

If the game code is found, take them to an "observer" screen.

If the game is still in the lobby, the observer screen is a simple "Waiting for
the game to start" screen, showing the player list and how many spectators are
watching.

When the game owner clicks "Start the game", all spectators should be taken to
something like the game screen, but without the hand area, and the message area
fills the bottom part of the screen.

Specators connecting or disconnecting never updates the nonce.

### Starting a game

The player who created the game can click the start button in the lobby screen
to begin the game. If there are less than 2 players, the game cannot be
started. Once a game is started, no more users can join, but more people can
watch.

When the game owner starts the game, all players see the lobby screen
change to the "game" screen.

### Game state

The server needs to track three sets of cards (called piles) and a hand of
cards for each player.

First is the "draw-pile", sometimes called "the deck".  This is the set of
cards from which players draw cards.  Cards in this pile are usually face-down,
but some cards (which will be defined later) may be face-up, so the server
must track that.  This pile can be shuffled, inspected, and cards can be
inserted into specific locations in it.

Second is the "discard-pile".  This is where cards are played, face-up.  The
discard-pile is empty at the start of the game.

Third is the "removed-pile".  This is where cards go when they are removed from
the game, such as when a player leaves the game or is out of the game.  Cards
in this pile are not part of the game anymore.  The removed-pile is empty at
the start of the game.

The server also needs to track the list of players, and whose turn it is now.

The server also needs to track the "pending operations" stack, which is used to
track what operations need to be performed and who played that operation.

#### Per-player state

Each player who is not "out" has a set of 0 or more cards, called their "hand".
The server needs to keep track of each player's hand.  It is positional, which
will be important later, and the users can reorder the cards within their hand
as they see fit.  Whenever a player plays a card, we need to verify that they
actually have that card in their hand first, to prevent abuse.

Clients should never have any information about the game except:
  * What cards are in their hand
  * What is showing on the top of the draw-pile
  * What is showing on the top of the discard-pile
  * The random-ordered list of players, and how many cards each player has
  * Whose turn it is now
  * Whose turn is next
  * The reaction timer, when needed
  * The number of turns the current player must take, when needed

### Playing the game

#### Turns

The game is played in turns.  At the beginning a random player is chosen to
start.  After that, play proceeds in order of the player list.

#### The game screen

The main "game" screen is split into several areas:
  * On the top left is the "player list" area, which shows all the players and
    their card counts. It highlights the player whose turn it is in light
    green, and whose turn is next in light orange.  The order of players is
    randomized at the start of the game, but all players see the same order.

  * Below the player list is the "timer" area which shows the reaction timer
    when needed.

  * To the right of those is the "table" area. It shows the draw-pile on the
    left and the discard-pile on the right. If either pile is empty, show a
    yellow-orange outline instead. Both piles, and their outlines, should be as
    large as possible in that area, while following these guidelines:
    - Prefer the piles to be next to each other horizontally, unless there's
      more room vertically than horizonally.
    - Leave a good margin at the edges of the table area
    - Leaving a good margin of space between the piles
    - Both piles are always the same size

  * Below those, across the whole screen, is the "message" area.  It has two
    parts.
    - At the top is a line showing information about whose turn it is, the
      "turn" area.
    - Below that is the "log" area.  It is at least 3 text lines tall.  When we
      talk about sending a message to players, this is where the message goes.
      It is a log, so new messages are always appended to the bottom, and the
      bottom is visible, while the top scrolls off, unless users choose to
      scroll back.

  * Below that, across the whole screen, is the "hand" area, which will show a
    player's cards.  If the player has a lot of cards they can be rendered
    smaller or wrapped to multiple lines. In the bottom right of the hand area,
    there is a "Leave the game" button.  Clicking this button first offers an
    "Are you sure you want to leave the game" dialog, and (if the player
    confirms) clears all of the client state, including the game code and
    nonce, and takes the player back to the landing page.  All that player's
    state is removed from the server, and all other players in the lobby are
    notified and their player lists are updated. The player's cards are removed
    (neither in the draw-pile nor the discard-pile) for the remainder of the
    game.  The hand area should have it's own vertical scroll functionality,
    when needed.

  * All of the areas should be fixed in place and size, unless the browser is
    resized. If the hand area is larger than the visible space, it can scroll
    vertically without affecting the other areas. Never scroll horizontally.
    Adding and removing cards from the hand area should never affect the size
    or position of any other area.

##### Message area - whose turn is it

For the player whose turn it currently is, the top line of the message area,
also called the "turn" area, shows "It's your turn", highlighted light green
like the player list.

For the player whose turn is next, the turn area shows "It is {player}'s turn.
You are next", highlighted light orange like the player list.

For all other players the turn area shows "It's {player}'s turn", highlighted
light blue.

##### Playing cards

A player's turn consists of two phases - playing cards, and drawing a card.
Unless a card's rules specifically say otherwise, the player must draw a card
to end their turn.

During their turn, the player may play 0 or more cards, either one at a time or
in combos.  To play a card, players drag and drop them from their hand into
discard-pile.  A played card appears, full size, on the discard-pile for all
players to see.

After a card is played, other players are given time to react to the played
card.  For example, a NAK may be played in response to any played card, unless
otherwise noted.  If a card is played in reaction, more cards may be played as
a reaction to that, and so on.  The reaction timer is shown in the timer area.

Once played, and all reactions are done, any card-specific rules or actions
must be followed (more on that later).  When a player decides they are done
with their turn, they must draw a card from the draw-pile, unless the last card
they played specifically said they do not need to draw a card.

When a player plays one or more cards, those cards are removed from the
player's hand in the server state and in their hand area, and all players can
see the last played card on the discard-pile.  We send a message to all players
that "{player} played a {card-class} card".  The card class is always in capital
letters.  If they played a pair of cards as a combo, the message is "{player}
played a pair of {card-class} cards".

##### Drawing a card

Only the current player can draw a card, by clicking on the draw-pile.  If any
other player clicks the draw pile, nothing happens.  If a client sends a
draw-card event to the server when it is not that player's turn, the server
must ignore it.

When a player draws a card, they see the top card as a large overlay for 3
seconds. When that is done, if it is a regular card (not "EXPLODING CLUSTER" or
"UPGRADE CLUSTER"), that card goes into their hand on the server and in their
hand area, and their turn is over.

During that time, game play is paused for all players while an animation runs.
Other players see a hand come in from the top of the table area, centered on
the draw pile.  The hand grabs the top card of the draw-pile, and then
withdraws back up off the top of the screen with the top card of the deck.

We send a message to all players that "{player} drew a card, it is
{next-player}'s turn", but never which card they drew.

##### Drawing an EXPLODING CLUSTER card

Drawing an EXPLODING CLUSTER card gets special rules.

If the player draws an "EXPLODING CLUSTER" card:
  * Regular play pauses.
  * The drawing player sees that card as a large overlay for 3 seconds, or
    until they press escape or click somewhere.  If they do not hit escape or
    click, the overlay is automatically dismissed after the timeout, and the
    EXPLODING CLUSTER card is is shown on the discard pile.
  * All other players see that card as a large overlay until play resumes.
    This overlay cannot be manually dismissed.

Once the drawing player has dismissed the overlay (either by timeout or by
hitting escape or clicking), they must debug their cluster.

If the player does not have a DEBUG card in their hand, they are out of the
game, and do not get any more turns.  For remaining players, the overlay is
dismissed after 3 seconds and the player list is updated with a strike-through
on their name. Send a message to all players that "{player}'s cluster
exploded!". All the cards in their hand plus the EXPLODING CLUSTER card are
removed from the duration of the game.  Play continues with the next player's
turn.

If the player has one or more DEBUG cards, their "turn area" turns red and says
"You must play a DEBUG card". Within the hand area, only DEBUG cards are
playable. The player must play a DEBUG card, and only a DEBUG card, by dragging
and dropping from their hand onto the discard pile. DEBUG cards cannot be NAKed
by another player.  There is no reaction allowed.

After playing a DEBUG card, their turn area goes back to normal.  Other players
get a log message like `"{player}'s cluster almost exploded, but they debugged
it!"

The player must then re-insert the EXPLODING CLUSTER card back into the draw
pile at any position they choose.  They get a modal dialog with a title like
"You're safe, for now", and the message "Where in the deck do you want to put the
EXPLODING CLUSTER card? 0 means the top of the deck, {N} means the bottom."
They enter a number from 0-N (where N is the number of cards in the deck), and
hit an "OK" button. Whatever number they enter, we put the EXPLODING CLUSTER
card back into the draw-pile at that position, from the top. If they chose 0, the card goes
on the top of the draw-pile.  If they chose {n}, the card goes at the bottom of
the draw-pile.

Once the EXPLODING CLUSTER card is re-inserted into the deck, the player's turn
is over.  All the EXPLODING CLUSTER overlays for all players are dismissed.
Play resumes with the next player's turn.

##### Drawing a face-down UPGRADE CLUSTER card

If the player draws an "UPGRADE CLUSTER" card, the current player sees that
card as a large overlay for 3 seconds, and then it is shown on the discard
pile.  Regular play pauses.  All other players see it as a large overlay until
play resumes.

The player must then re-insert the UPGRADE CLUSTER card back into the draw-pile
at any position they choose.  Unlike EXPLODING CLUSTER cards, the UPGRADE
CLUSTER card is re-inserted face-up.  The player is prompted to choose a
position, like: "There are {n} cards in the draw-pile, where do you want to put
the UPGRADE CLUSTER card? (0 is the top of the deck, {n} is the bottom)". They
need to enter a number from 0 to N, and whatever they enter, we put the UPGRADE
CLUSTER card back into the draw-pile at that position. If they chose 0, the
card goes on the top of the draw-pile.  If they chose {n}, the card goes at the
bottom of the draw-pile.

Once the UPGRADE CLUSTER card is re-inserted into the deck, the player's turn
is over and it becomes the next player's turn.

##### Drawing a face-up UPGRADE CLUSTER card

If the player draws a face-up UPGRADE CLUSTER card, all players see that cards
as a large overlay for 3 seconds. After that, the currect player is out of the
game, and it is the next player's turn.  There is no reaction allowed.

##### Winning

When there is only one player left, that player wins.  Send a message to all
players that "{player} wins!", and halt the game.

If the next-to-last player leaves the game, either by clicking the button or by
navigating away, show a dialog to the last remaining player and any observers
titled "{player} wins!" with a message "Winning by attrition is still
winning.". When they acknowledge the dialog, take them back to the landing
page.

#### UI: the "hand" area

##### Rendering cards

The players' hand is shown in the hand area.  The hand area is rendered in
rows or cards.

If there are too many cards such that we need to wrap to a second row, it
should always wrap more than one card, so that the rows are approximately
equal.  For example, if the hand area can fit 7 cards across, but we have 8
cards in the hand, wrap it so there are 2 rows of 4 cards each.  If the area
can fit 6 cards across and we have 7, wrap it so there are 2 rows: 4 cards on
top and 3 on bottom.  Always keep the rows of cards centered horizontally. Do
not wrap to another row until we absolutely have to.

When the first two rows are filled and we need to add a third row, first make
the cards 20% smaller, so we can fit a few more into 2 rows. Don't go smaller
than that. Once cards are being rendered smaller, they stay at the smaller size
until the number of cards in the hand is reduced and all cards can fit in two
rows at the regular size.

Example: Suppose the browser is sized such that 6 cards fit horizontally at regular size and 8 at the smaller size.
  * When I have 8 cards it should be rendered as two rows of 4 cards, regular size
  * 9 cards is rendered as two rows, 5+4, at regular size
  * ...and so on until 12 cards, which is two rows of 6, regular size
  * When the player draws a 13th card, it can't fit without a 3rd row
  * Shrink all cards to the smaller size
  * 13 cards can now render as two rows, 7+6, in the smaller size
  * 14 cards is 7+7, small
  * 15 is 8+7, small
  * 16 is 8+8, small
  * Drawing the 17th card must overflow to a 3rd row, since cards are already small
  * 17 cards is rendered as three rows, 6+6+5, in the small size
  * 18 is 6+6+6
  * ...and so on up to 24, which is 3 rows, 8+8+8
  * The 25th card needs a 4th row
  * Render 25 cards as 4 rows, 7+7+6+5, small size.
  * ...and so on

##### Reordering cards

If the player drags and drops cards within their hand (not to the table area),
the cards should be reordered on the server and rendered for that player.  This
can happen at any time, even when it is not that player's turn.

Cards must be reorderable across multiple rows in the hand area. For example,
if the player has 3 rows of cards, it must be possible to drag from the first
row to the any other row, and vice versa.

##### Playable and unplayable cards

Each card has some time periods where is is playable and some where it is not,
which will be detailed later.

Playable cards should be rendered as per their image.

Unplayable cards should be rendered as per their image, but slightly faded out.

These rules apply to all time periods.

"Now" cards are playable during other players turns.

If someone tries to drag an unplayable card to the discard-pile, it should have
no effect.  The client should not send a "play" event to the server, and the
server should ignore any such events if they are sent.  No error message is
needed.

##### Hand layout

Always render playable and unplayable cards in the order the player has sorted
them in their hand.

Never overflow horizontally if there are too many cards to fit.  Instead, wrap
to multiple lines as needed, or make the cards smaller.

When adding an outline to a card, the other cards should not move on the
screen.  Make sure that is always true.  Pre-render the outline as the same
color as the table, if needed.

##### Selecting cards

If the player single-clicks a playable card in their hand, that selects the
card - put a blue outline around it.

If the player single clicks an already-selected card a second time, it
de-selects the card - remove the outline (or change it to the background
color).

If the player single-clicks an unplayable card in their hand, do nothing.

If the player single-clicks a playable card while a different card is selected,
deselect the previous card and select the new one.

If the player single-clicks an unplayable card while a different card is
selected, do nothing.

If a player single-clicks a playable DEVELOPER card (making it selected) and
then shift-clicks (single-click while pressing the SHIFT key) on another
identical DEVELOPER card, also select the second card.  This is called a valid
combo.  Only identical DEVELOPER cards (same class and name) can be selected as
part of a combo.  Combos can only have 2 cards selected.  Trying to shift-click
a third card does nothing.  Trying to shift-click any card except DEVELOPER
cards does nothing.

If there is a valid combo selected, and the player single-clicks a different
playable card, deselect both cards in the combo and select the new card.

If any card or cards are selected, and the player clicks on the empty space in
the hand area (not on a card), deselect all selected cards.

For example:
  * Click NAK - select the card
  * Click SHUFFLE - deselect NAK, select SHUFFLE
  * Click another NAK - deselect the first NAK, select SHUFFLE
  * Shift-click another NAK - do nothing
  * Click the selected NAK again - deselect the card
  * Click DEVELOPER "foo" - select the card
  * Shift-click DEVELOPER "bar" - do not select the card (not identical)
  * Shift-click DEVELOPER "foo" - select the second card (a valid combo)
  * Click NAK - deselect both DEVELOPER cards, select NAK

##### Playing cards

If there are no cards selected and the player clicks and drags a card to the
discard-pile, that card is selected (outlined) and played.

If there is a single card selected and the player clicks and drags that
selected card to the discard-pile, that card is played.

If there is a single card selected and the player clicks and drags a different
card to the discard-pile, the originally selected card is deselected (outline
removed) and the new card is selected (outlined) and played.

If there is a valid combo of DEVELOPER cards selected and the player clicks and
drags one of those cards to the discard-pile, both cards are played together.

If a single DEVELOPER card is dragged to the discard pile, that card is not
played.  Return it to the player's hand.

If there is a valid combo of cards selected and the player clicks and drags a
different card to the discard-pile, the combo is deselected (outline removed
from both) and the new card is selected (outlined) and played.

When dragging a combo of DEVELOPER cards to the discard-pile, both cards should
be rendered as being dragged together.

When a card or a combo is played, remove the card or cards from the player's
hand on the server, and put them on the discard-pile.  All players should see
the top card of the discard-pile and receive a message about what was played,
like "{player} played {card-class}" or "{player} played a pair of
{card-class}".

##### Inspecting cards

If the player double clicks a card in their hand, show that card in a large
overlay, until the player clicks somewhere or hits the ESCAPE key.

#### UI: The table area

The table area is green like a blackjack table, with the draw-pile and the
discard-pile centered on it, left-to-right. If either pile is empty, show a
yellow-orange outline instead.

The draw-pile and the discard-pile, or their outlines should be rendered as large as possible, but
they must always be the same size.

#### Beginning the game

At the beginning of the game, when the "start game" is clicked, the deck
contains all of the cards.

Remove all of the "EXPLODING CLUSTER", "UPGRADE CLUSTER", and "DEBUG" cards
from the deck, temporarily.

Each player gets 1 DEBUG card in their hand. Put 2 DEBUG cards back into the
deck, or 1 DEBUG card if that is all that is left. Any extra DEBUG cards are
removed from the game.

Shuffle the deck.

Each player gets 7 more cards from the deck, for a total of 8 cards in each
player's hand.  Note that the EXPLODING CLUSTER and UPGRADE CLUSTER cards are
not in the deck at this point, so no player can get one of those cards in their
initial hand.

Once those are dealt, put one less than the number of players EXPLODING
CLUSTER cards into the deck. For example, if there are 3 players, put 2
EXPLODING CLUSTERS cards in. If there are 5 players, put 4 in.  Any extra
EXPLODING CLUSTER cards are removed from the game.

If there are 3 or 4 players put 1 UPGRADE CLUSTER card into the deck. If there
are players, put 2 UPGRADE CLUSTER cards in.  Any extra UPGRADE CLUSTER cards
are removed from the game.

Shuffle the deck.

That is the draw-pile.  Render it on the table area.  The initial discard-pile
is empty.

##### DEVMODE

If the game server was started with DEVMODE=1 in its environment, then the game
is in developer mode.  In developer mode, the following things are different:

  * The first game code is "XXXXX". Subsequent game codes are random as usual.

  * When the game is created, the draw-pile starts with an EXPLODING CLUSTER
    card on top.

  * The first player's hand starts with 2 identical DEVELOPER cards and a third
    non-identical DEVELOPER card, plus 2 NAK cards, a SHUFFLE card, and a FAVOR
    card.

  * The second player's hand starts with a NAK card, a SKIP card, a SHUFFLE NOW
    card, an ATTACK card, a SEE THE FUTURE card, and 2 DEVELOPER cards (one
    identical to the solo DEVELOPER card in player 1's hand, one different).

  * The third player's hand starts with a NAK card, a SKIP card, a FAVOR
    card, an ATTACK card, a SEE THE FUTURE card, and 2 DEVELOPER cards (one
    identical to the solo DEVELOPER card in player 1's hand, one different).

  * Other players' hands are dealt from the deck.

  * The player list is ordered by join sequence.  The game creator is first, the
    second player to join is second, and so on.

  * The game creator is always the first player to play.

  * The player list area shows a "Give me a DEBUG card" button at the bottom.
    If the player clicks that button, they get a DEBUG card added to their hand
    from the deck. If there are no DEBUG cards left in the deck, disable that
    button for all players.

  * The player list area shows a "Give me safe card" button at the bottom. If
    the player clicks that button, they get the first card from the deck which
    is not    EXPLODING CLUSTER or UPGRADE CLUSTER added to their hand. If
    there are no safe left cards in the deck, disable that button for all
    players.

  * The player list area shows a "Show the deck" button at the bottom. If
    the player clicks that button, they see the entire draw-pile as a list of
    cards in a large overlay.

  * The player list area shows a "Show removed cards" button at the bottom.
    If the player clicks that button, they see the entire removed-pile as a
    list of cards in a large overlay.

  * Below the draw-pile and the discard-pile is the number of cards in each
    pile, e.g. "(21 cards)".

  * The random seed uses the fixed value 0, so that shuffling and initial
    player selection, and other things are deterministic for testing.

#### Taking turns

We need to give players time to react to each other.  Let's define some time
periods, so we can speak about them more precisely.

We call the whole time period from the beginning of a player's turn until they
draw the "turn" period.  If the player draws an EXPLODING CLUSTER card we call
the period until they play a DEBUG card the "exploding" period.

Within the turn period there are several sub-periods.  At the beginning of a
players turn, when they need to play a card or draw, we call that the "action"
period.  If the player plays a card during their action period, except for a
DEBUG card, a timer is set and a large 8 second countown is drawn in the timer
area. That period is called the "reaction period".

If nothing else is played by any player, the timer expires, the played cards
are executed (more below) and it becomes the "action" period again.

If, during the reaction period, another player plays a "now" card or a NAK
card, the timer is reset to 8 seconds and it remains the reaction period.
During reaction any player, except the player who just played, may play another
"now" card or a NAK card.  Every time a card is played, the timer is restarted.

When the timer finally expires the played cards are executed and it becomes the
"action" period again.

That cycle repeats until the player draws a card.  Every time the timer is
restarted, it is set to 8 seconds.

#### Race condition: two players playing at the same time

When playing a card, the client must send the last known nonce.  If that nonce
matches the server's current nonce, the server accepts the played card.  If it
does not match, the server rejects the played card, and sends a message to the
player.

This should prevent two players inadvertently playing at the same time due to
network lag, and causing confusion.

#### Playing NAK cards

NAK cards are only playable during reaction periods, in response to another
played card.  They are not playable during action periods.

##### Example of turns and the action/reaction logic

Let's consider an example using 3 hypothetical cards (these cards are to
simplify example, they are not part of the real game):
  * PUNCH: When executed this does nothing (unimportant for this example).
  * CHEAT: When executed this does nothing (unimportant for this example).
    This is a "now" card.
  * BLOCK: When executed this pops another item from the operation stack and
    discards it.  This is a "now" card.

There are 3 players, A, B, C.

  * Player A's turn
    - Begin action period
      - Player A plays a PUNCH card
    - Begin reaction period, start timer
      - Any player except A can play a NAK or "now" card
      - Timer expires
    - Begin another action period
      - Player A draws a card
      - Their turn turn is over

  * Player B's turn
    - Begin action period
      - Player B plays a PUNCH card
    - Begin reaction period, start timer
      - Any player except B can play a NAK or "now" card
      - Player A plays a BLOCK card
    - Restart reaction period, restart timer
      - Any player except A can play a NAK or "now" card
      - Player C plays a BLOCK card
    - Restart reaction period, restart timer
      - Any player except C can play a NAK or "now" card
      - Player B plays a BLOCK card
    - Restart reaction period, restart timer
      - Any player except B can play a NAK or "now" card
      - Player A plays a CHEAT card
    - Begin reaction period, restart timer
      - Any player except A can play a NAK or "now" card
      - Timer expires
    - Begin another action period
      - Player B draws a card, it is an EXPLODING CLUSTER card
    - Begin exploding period
      - Other players cannot do anything
      - Player B plays a DEBUG card
      - Player B reinserts the EXPLODING CLUSTER card into the deck
      - Their turn is over

  * Player C's turn
    - Begin action period
      - Player A plays a CHEAT card
    - Begin reaction period, start timer
      - Any player except A can play a NAK or "now" card
      - Player C plays a BLOCK card
    - Restart reaction period, restart timer
      - Any player except C can play a NAK or "now" card
      - Timer expires
    - Begin another action period
      - Player C draws a card, it is an EXPLODING CLUSTER card
      - They do not have a DEBUG card
      - They are out of the game

  * Player A's turn (again)

##### What cards can be played in which periods

All the cards will be defined in a later section of this doc. This section will
define when cards can be played.

Each card has some periods where is is playable.  Most cards (e.g. FAVOR,
SHUFFLE) are playable by a player only during their own action period.

Some cards (e.g. DEVELOPER) are playable by a player only during their own
action period, but only in pairs.

Some cards (DEBUG) are only playable while that player is exploding.

Some cards (NAK) are playable by any player, but only during reaction periods,
in response to another played card.

Some cards are considered "now" cards and are playable by any player during
action or reaction.

##### Example of the operation stack

This is tricky logic, so let's describe it in more detail.

Each card has an associated operation which is to be executed when the timer
expires. Let's model this as the "pending operations" stack.

Every time a card is played, as per the above rules, we push it onto the stack
and the timer is reset. When the timer finally expires, we need to pop
operations until the stack is empty. Pop an item, do the operation, repeat.

Let's consider an example using 3 hypothetical cards (these cards are to
simplify example, they are not part of the real game):
  * PUNCH: When executed this does nothing (unimportant for this example).
  * CHEAT: When executed this does nothing (unimportant for this example).
    This is a "now" card.
  * BLOCK: When executed this pops another item from the operation stack and
    discards it.  This is a "now" card.

There are 3 players, A, B, C.  It is player A's turn:
  * Player A plays a "PUNCH" card
  * Push "PUNCH" on the stack
  * Start the timer
  * Player B plays a "BLOCK" card
  * Push "BLOCK" on the stack
  * Restart the timer
  * Player A plays a "BLOCK"
  * Push "BLOCK" on the stack
  * Restart the timer
  * Player C plays a "CHEAT"
  * Push "CHEAT" on the stack
  * Restart the timer
  * No more cards are played
  * Timer expires
  * Pop an item - it's "CHEAT"
  * Execute CHEAT (does nothing)
  * Stack has more items
  * Pop an item - it's "BLOCK"
  * Execute BLOCK (pops another item, also BLOCK, and discards it)
  * Stack has more items
  * Pop an item - it's "PUNCH"
  * Execute PUNCH (does nothing)
  * No more items on the stack
  * Player A may play again or draw to end his turn

### Card definitions

The full deck is comprised of 66 cards:
  - 4 "EXPLODING CLUSTER" cards
  - 2 "UPGRADE CLUSTER" cards
  - 4 "ATTACK" cards
  - 6 "DEBUG" cards
  - 4 "FAVOR" cards
  - 5 "NAK" cards
  - 5 "SEE THE FUTURE" cards
  - 3 "SHUFFLE" cards
  - 1 "SHUFFLE NOW" card
  - 4 "SKIP" cards
  - 28 "DEVELOPER" cards: 7 sets of 4 identical cards.

Each card has a face-image which will be enumerated below.  All cards have the
same back image, stored in a file `./cards/back.png`.

Each card has a class, a name, an image, a flag indicating if it is a "now" card or
not, a flag indicating if it must be played as a combo or not, and a count of
how many copies of this card are in the deck. Each class of card also has a
different action, which will be detailed after the YAML.

All the cards will be detailed in the following YAML document.  It is YAML for
clarity, It doesn't need to be YAML in the implementation.

In the code, card classes should use underscores instead of spaces, e.g.
`EXPLODING_CLUSTER` instead of `EXPLODING CLUSTER`.

```
cards:
  - class: EXPLODING CLUSTER
    name: broken_logo
    image: ./cards/exploding_-_broken_logo.png
    now: false
    combo: false
    count: 1

  - class: EXPLODING CLUSTER
    name: deathstar
    image: ./cards/exploding_-_deathstar.png
    now: false
    combo: false
    count: 1

  - class: EXPLODING CLUSTER
    name: ghost
    image: ./cards/exploding_-_ghost.png
    now: false
    combo: false
    count: 1

  - class: EXPLODING CLUSTER
    name: phippy
    image: ./cards/exploding_-_phippy.png
    now: false
    combo: false
    count: 1

  - class: UPGRADE CLUSTER
    name: logos1
    image: ./cards/upgrade_-_logos1.png
    now: false
    combo: false
    count: 1

  - class: UPGRADE CLUSTER
    name: logos2
    image: ./cards/upgrade_-_logos2.png
    now: false
    combo: false
    count: 1

  - class: ATTACK
    name: bikeshed
    image: ./cards/attack_-_bikeshed.png
    now: false
    combo: false
    count: 1

  - class: ATTACK
    name: dash_dash_force
    image: ./cards/attack_-_dash_dash_force.png
    now: false
    combo: false
    count: 1

  - class: ATTACK
    name: push_on_friday
    image: ./cards/attack_-_push_on_friday.png
    now: false
    combo: false
    count: 1

  - class: ATTACK
    name: use_latest
    image: ./cards/attack_-_use_latest.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: cpr
    image: ./cards/debug_-_cpr.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: elementary
    image: ./cards/debug_-_elementary.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: git_bisect
    image: ./cards/debug_-_git_bisect.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: roll_it_back
    image: ./cards/debug_-_roll_it_back.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: silence
    image: ./cards/debug_-_silence.png
    now: false
    combo: false
    count: 1

  - class: DEBUG
    name: swarm
    image: ./cards/debug_-_swarm.png
    now: false
    combo: false
    count: 1

  - class: FAVOR
    name: code_review
    image: ./cards/favor_-_code_review.png
    now: false
    combo: false
    count: 2

  - class: FAVOR
    name: cut_paste
    image: ./cards/favor_-_cut_paste.png
    now: false
    combo: false
    count: 2

  - class: NAK
    name: backlog
    image: ./cards/nak_-_backlog.png
    now: false
    combo: false
    count: 1

  - class: NAK
    name: kelsey
    image: ./cards/nak_-_kelsey.png
    now: false
    combo: false
    count: 1

  - class: NAK
    name: next_release
    image: ./cards/nak_-_next_release.png
    now: false
    combo: false
    count: 1

  - class: NAK
    name: prs_welcome
    image: ./cards/nak_-_prs_welcome.png
    now: false
    combo: false
    count: 1

  - class: NAK
    name: slash_close
    image: ./cards/nak_-_slash_close.png
    now: false
    combo: false
    count: 1

  - class: SEE THE FUTURE
    name: dashboard
    image: ./cards/see_future_-_dashboard.png
    now: false
    combo: false
    count: 1

  - class: SEE THE FUTURE
    name: date_driven
    image: ./cards/see_future_-_date_driven.png
    now: false
    combo: false
    count: 1

  - class: SEE THE FUTURE
    name: dry_run
    image: ./cards/see_future_-_dry_run.png
    now: false
    combo: false
    count: 1

  - class: SEE THE FUTURE
    name: learn_from_past
    image: ./cards/see_future_-_learn_from_past.png
    now: false
    combo: false
    count: 1

  - class: SEE THE FUTURE
    name: release_notes
    image: ./cards/see_future_-_release_notes.png
    now: false
    combo: false
    count: 1

  - class: SHUFFLE
    name: double_trouble
    image: ./cards/shuffle_-_double_trouble.png
    now: false
    combo: false
    count: 1

  - class: SHUFFLE
    name: node_failure
    image: ./cards/shuffle_-_node_failure.png
    now: false
    combo: false
    count: 1

  - class: SHUFFLE
    name: rolling_update
    image: ./cards/shuffle_-_rolling_update.png
    now: false
    combo: false
    count: 1

  - class: SHUFFLE NOW
    name: eventually_consistent
    image: ./cards/shuffle_now_-_eventually_consistent.png
    now: true
    combo: false
    count: 1

  - class: SKIP
    name: oncall
    image: ./cards/skip_-_oncall.png
    now: false
    combo: false
    count: 1

  - class: SKIP
    name: ooo
    image: ./cards/skip_-_ooo.png
    now: false
    combo: false
    count: 1

  - class: SKIP
    name: tech_debt
    image: ./cards/skip_-_tech_debt.png
    now: false
    combo: false
    count: 1

  - class: SKIP
    name: unicorn
    image: ./cards/skip_-_unicorn.png
    now: false
    combo: false
    count: 1

  - class: DEVELOPER
    name: firefighter
    image: ./cards/developer_-_firefighter.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: grumpy_greybeard
    image: ./cards/developer_-_grumpy_greybeard.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: helper
    image: ./cards/developer_-_helper.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: intern
    image: ./cards/developer_-_intern.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: logical
    image: ./cards/developer_-_logical.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: nit_picker
    image: ./cards/developer_-_nit_picker.png
    now: false
    combo: true
    count: 4

  - class: DEVELOPER
    name: prow_robot
    image: ./cards/developer_-_prow_robot.png
    now: false
    combo: true
    count: 4
```

Each card has a unique "ID" which is the tuple of {class}, {name}, and
{ordinal}. For example, the first "logical" DEVELOPER card is `(DEVELOPER,
logical, 0)` and the third "intern" DEVELOPER card is `(DEVELOPER, intern, 2)`.
This is important to identify cards uniquely in the server.

As part of the implementation, the card images must be copied into a place
which makes sense in the repository, so they can be served to the client.

#### Actions for each card class

Actions are only performed when the reaction timer expires, as per the
action/reaction loop described above.

EXPLODING CLUSTER cards have already been detailed.

DEBUG cards have already been detailed.

Playing a NAK card pops 1 extra item off the operations stack, if possible,
and discards it.  If the stack was empty this card does nothing.  Playing a NAK
after a NAK negates the first NAK.

Playing a SHUFFLE card shuffles the draw-pile and send a message to all players
that "The deck was shuffled".

SHUFFLE NOW cards are the same action as SHUFFLE cards, but may be played by
any player during any action or reaction period.

Playing a SEE THE FUTURE card shows the current player the top 3 cards from the
draw-pile in a large overlay, with a "Done" button.  When the player clicks
"done", the overlay is closed, but the cards remain in their places in the
deck. A message is sent to all players that "{player} saw the future".

Playing a FAVOR card pops up a dialog asking the current player to choose one
of the other remaining players, called the victim.  The player may not choose a
victim with 0 cards in their hand.  The victim gets a message saying "{player}
asked you for a favor" and to all other players saying "{player} asked {victim}
for a favor". Victim must choose a card to give to the current player, which is
moved from victim's hand to the current player's hand.

DEVELOPER cards must be played in pairs.  Playing a DEVELOPER pair pops up a
dialog asking the current player to choose one of the other remaining players,
called the victim.  The player may not choose a victim with 0 cards. in their
hand.  The player is then asked to choose a card from 0 to N-1 (where N is the
number of cards in the victim's hand). The victim gets a message saying
"{player} stole a card from you" and to all other players saying "{player}
stole a card from {victim}".  The card in the victim's hand at the chosen
position flashes 3 times and then disappears.  It is moved to the current
player's hand.

Playing an ATTACK card ends the current player's turn immediately, without
drawing a card, and forces the next player to take 2 turns in a row.  A message
is sent to all players that "{player} attacked {victim} for {n} turns".  If the
victim of an ATTACK plays another ATTACK card on any of their turns, the
attacks "stack up" and their turns are transferred to the next victim, who must
take the attacker's current and untaken turn(s) PLUS 2 more.  For example, if
player A attacks player B, then player B must take 2 turns.  If on the first of
those turns, player B attacks player C, then player C must take 4 turns (the
original 2 from A attacking B, plus 2 more from B attacking C).  Player B's
ATTACK does not consume one of player B's turns.  If player B first drew a
card, that would consume one of their turns.  If player B then played ATTACK,
player C must take 3 turns (the remaining 1 from A attacking B, plus 2 more
from B attacking C). The victim of an attack should see a counter of turns
remaining in the timer area.

Playing a SKIP card immediately ends the current player's turn, without drawing
a card.  If a SKIP card is used after an ATTACK has been played, it only clears
1 of the ATTACK card's attacks.  Playing 2 SKIP cards would defend against an
ATTACK. A mesage is sent to all players saying {player} skipped their turn".

When a player draws an UPGRADE CLUSTER card, they must reinsert it into the
deck, the same as an EXPLODING CLUSTER card, except it goes in face-up.  They
do not need to play a DEBUG card.  When a player is forced to draw the face-up
UPGRADE CLUSTER card, they are immediately out of the game.  This card can not
be stopped with a DEBUG or NAK.  If the deck is shuffled, this card must remain
face up.

## Part 2: Implementation

This game is to be implemented incrementally.  After each stage you must stop
so we do some QA, and ensure everything is working well before proceeding.  As
much as possible, we should automate test cases to ensure no regressions.

### Critical constraints

This game is to be written in modern Node.js, using Next.js, React, and
typescript. It is critical that this code be modern, high quality and have lots
of great comments. You are an expert in these technologies.

This game will run on Linux.

It should use all modern best practices.  If you think there is a better way to
do something, you must ask me, but I want you to tell me what you think is good
technology for this app.

The code should always pass linting.

It must have robust unit tests to ensure no regressions as we make progress.
Every major piece of logic must have tests, and those tests must pass.  To run
`npm` tests, always invoke it like `npm test -- --no-watch` so that it runs
once and exits with a proper exit code.

It must have robust browser tests to ensure the UI works as expected.  Use
Playwright for this.  Every major UI flow must have tests, and those tests must
pass.

Always try to make the smallest possible change to implement a feature.  Avoid
big changes that do many things at once.

Do not generate files that are not needed.  I use `vim` for editing and `git`
for source control.

#### Logging

This app should emit useful debugging logs, both on the server's stdout or
stderr and on the client's console, which can be used by humans or AIs when we
hit a problem.  Make sure to include the game code in every log-line that
relates to a game.

When logging player names, always log both the player name, in double quotes,
and the player ID.  For example `player "Joe Smith" (ABC123)`.

Always log timestamps.

Always start logs with a lowercase letter unless it is a proper noun or
acronym. Thw words "game" and "player" and "server" are not proper nouns.

Never end log lines with a period.

##### Server logs

If a log line is about a specific game, do not include the game code in the
message, just in the log header.

Add a server parameter which enables verbose logging, which includes logging
every message sent and received by the server and client.

##### Client logs

Use `console.debug` for verbose logging on the client.  A normal game should
not log very much to the console, unless debug logs are enabled.

### UI

The web UI for this app must be beautiful and modern, very reactive and
interactive, and as simple as possible to use.  Don't use tiny text or buttons.
Make it beautiful with good sized text and ample spacing.  Use modern web UI
styles and techniques.

A prototype UI exists in ./prototype -- copy that UI design where possible.

Whenever we show a dialog, maker sure that pressing ENTER on the keyboard
presses the default button in the dialog.  If applicable, pressing ESCAPE
should press the cancel button.

### Browser testing

We need the following browsers tests to work:

  1) Happy path: 2 players + observer
      * Player 1 creates a game.
      * Player 2 joins the game.
      * An observer watches the game.
      * Lobby updates are verified for all clients.
      * Player 1 starts the game.
      * All clients navigate to their respective game screens.
      * Observer UI is verified to not show a hand.

  2) Game-is-full rejection
      * Player 1 creates a game.
      * Four additional players join, filling the game to 5 players.
      * A sixth player attempts to join.
      * The sixth player is rejected with a "game is full" error.

  3) Duplicate-name rejection
      * Player 1 creates a game as "Alice".
      * Player 2 attempts to join the same game also as "Alice".
      * Player 2 is rejected with a "name is already taken" error.

  4) Join non-existent game
      * A player attempts to join a game with a non-existent game code.
      * The player is rejected with a "game does not exist" error.

  5) Watch non-existent game
      * An observer attempts to watch a game with a non-existent game code.
      * The observer is rejected with a "game does not exist" error.

  6) Reconnect to lobby
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 2 navigates away (disconnects).
      * Player 1's lobby updates to show player 2 as absent.
      * Player 2 navigates back to the game.
      * Player 2 successfully rejoins the lobby.
      * Player 1's player list updates to show player 2 as present again.

  7) Reconnect fails after nonce change
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 2 navigates away (disconnects).
      * Player 3 joins the game (triggering a nonce change).
      * Player 2 attempts to navigate back to the game.
      * Player 2 is rejected with a "game has changed" dialog.

  8) Game owner reassignment
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 3 joins the game.
      * Player 1 navigates away (disconnects).
      * Verify that another player is assigned as the new game owner.
      * Player 1 navigates back to the game.
      * Player 1 successfully rejoins the lobby.
      * Other players' player lists update to show player 1 as present again.

  9) Turn area colors
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 3 joins the game.
      * Player 1 starts the game.
      * Verify that it is player 1's turn.
      * Verify that player 1's turn area is green.
      * Verify that player 2's turn area is orange.
      * Verify that player 3's turn area is blue.

  10) Abandoned turn
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 3 joins the game.
      * Player 1 starts the game.
      * Verify that it is player 1's turn.
      * Verify that player 1's turn area is green.
      * Player 1 navigates away (disconnects).
      * Verify that players 2 and 3 get a message that player 1 has abandoned
        their turn.
      * Verify that player 2's turn starts.
      * Verify that player 2's turn area is green.
      * Player 1 attempts to navigate back to the game.
      * Player 1 is rejected with a "game has changed" dialog.

  11) Attrition win
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 2 leaves the game via the "Leave Game" button.
      * Player 1 receives a "You win!" dialog.
      * Player 1 acknowledges the dialog and navigates to the landing page.

  12) Card overlay escape
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 double-clicks a card in their hand.
      * A large card overlay appears.
      * Player presses Escape.
      * The card overlay disappears.

  13) DEVMODE: Debug card button
      * Player 1 creates a game (in DEVMODE).
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 repeatedly clicks "Give me a DEBUG card" button.
      * Verify DEBUG cards appear in Player 1's hand.
      * The "Give me a DEBUG card" button becomes disabled.

  14) DEVMODE: Give a card button
      * Player 1 creates a game (in DEVMODE).
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 clicks "Give me another card" button.
      * Verify that a non-EXPLODING CLUSTER, non-UPGRADE CLUSTER card appears in Player 1's hand.
      * Player 1 clicks "Give me another card" button.
      * Verify that a non-EXPLODING CLUSTER, non-UPGRADE CLUSTER card appears in Player 1's hand.
      * Player 1 clicks "Give me another card" button.
      * Verify that a non-EXPLODING CLUSTER, non-UPGRADE CLUSTER card appears in Player 1's hand.

  15) DEVMODE: Show deck overlay escape
      * Player 1 creates a game (in DEVMODE).
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 clicks "Show the deck" button.
      * A draw-pile overlay appears.
      * Player presses Escape.
      * The draw-pile overlay disappears.

  16) DEVMODE: Show removed overlay escape
      * Player 1 creates a game (in DEVMODE).
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 clicks "Show removed" button.
      * A removed-pile overlay appears.
      * Player presses Escape.
      * The removed-pile overlay disappears.

  17) Reorder cards in hand
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 drags and drops cards in their hand to reorder them.
      * The new order is verified.

  18) Correct number of debug cards
      * Creates and starts a game with two players.
      * Opens the "Show the deck" overlay.
      * Counts the number of debug cards remaining in the deck.
      * Verifies there are exactly 2 debug cards in the deck (6 total - 2 dealt - 2 removed).

  19) Verify hand counts and debug card
      * Creates and starts a game with two players.
      * Verifies player 1 has exactly 8 cards.
      * Verifies player 2 has exactly 8 cards.
      * Verifies both players have at least 1 DEBUG card in their hand.

  20) TODO: Card selection
      * Player 1 creates a game.
      * Player 2 joins the game.
      * Player 1 starts the game.
      * Player 1 clicks a card in their hand.
      * The card is outlined to show selection.
      * Player 1 clicks the same card.
      * The card is no longer outlined.
      * Player 1 selects a non-DEVELOPER card.
      * The card is outlined to show selection.
      * Player 1 selects another non-DEVELOPER card.
      * The first card is deselected and the new card is selected.
      * Player 1 selects a DEVELOPER card.
      * The card is outlined to show selection.
      * Player 1 shift-clicks a different DEVELOPER card of a different name.
      * Nothing happens.
      * Player 1 shift-clicks a different DEVELOPER card of the same name as
        the selected card.
      * Both DEVELOPER cards are outlined to show selection.
      * Player 1 shift-clicks a third DEVELOPER card of the same name.
      * Nothing happens.
      * Player 1 clicks a non-DEVELOPER card in their hand.
      * The card is outlined to show selection.

  21) TODO: playing cards

  22) TODO: drawing cards
  23) TODO: leave while drawing explodign cluster/upgrade cluster

  24) Action/reaction logic
      * P1 creates game
      * P2 joins
      * P1 starts game
      * Verify P1's lone `DEVELOPER` card is not playable but others are
      * Verify P2's `SHUFFLE_NOW` is playable and nothing else
      * P1 plays `SHUFFLE`
      * Verify that none of P1's cards are playable
      * Verify that P2's `NAK` and `SHUFFLE_NOW` cards are playable
      * P2 plays `NAK`
      * Verify that none of P2's cards are playable
      * Verify that P1's `NAK`s are playable
      * P1 plays NAK
      * Verify thast none of P1s cards are playable
      * Verify that P2s `SHUFFLE_NOW` is playable
      * P2 plays `SHUFFLE_NOW`
      * Verify that none of P2s cards are playable
      * Verify that P1's NAK is playable
      * P1 plays NAK
      * Verify that neither player has playable cards

### Implementation phases

#### Phase 1: Server and client

Implement the server and client skeletons, with no game logic.

Implement the WebSocket connection between the client and server, with
heartbeats to detect disconnects.

Implement logging and infoz.

Implement the landing, lobby, create game, and join game pages.

Implement the "start game" and "join game" logic.

Implement the game page with the basic layout, but no game logic.

Implement the player list, message area, timer area, table area, and hand area.

Implement the per-game nonce.

Implement the large overlay for inspecting cards.

Implement DEVMODE features.

#### Phase 2: Hand and table UI

##### Phase 2.1: Reordering the hand

Implement drag and drop reordering of cards within the hand area.

##### Phase 2.2: Card selection

Implement card selection, including multi-card combos.

##### Phase 2.3: Playing cards

Implement drag and drop of cards from the hand area to the discard-pile to play
them (but do not implement the card actions yet).  This includes single and
multi-card play.

##### Phase 2.4: Drawing cards

Implement drawing cards from the draw-pile (but do not implement the EXPLODING
CLUSTER or UPGRADE CLUSTER logic yet).

#### Phase 3: Turns

##### Phase 3.1: Actions and reactions

###### Phase 3.1.1: Operations

Implement the operations stack, but do not implement any card actions yet.  It
is a stack of functions which take current game as input and modify it.

Whenever a card is played, push a do-nothing operation onto the stack.

When the turn ends, before it becomes the next player's turn, pop each
operation from the stack and execute it

###### Phase 3.1.2: Turn logic, simple

Implement a simplified form of the action/reaction logic and timer.  When a
player plays a card, start the reaction timer, during which time they may not
play again or draw a card, but OTHER players may play "now" cards.  When the
timer expires, the current player may play again or draw to end their turn.

When the timer expires, pop and execute all operations from the stack.

Do not implement any card actions yet.

###### Phase 3.1.3: Turn logic, full

Implement the action/reaction logic and timer fully, as specced above.  This
includes the loop of restarting reaction periods.

When the timer expires, pop and execute all operations from the stack.

Do not implement any card actions yet.

##### Phase 3.2: Playable and unplayable cards

Implement playable and unplayable cards and their rendering.

##### Phase 3.3: Drawing EXPLODING CLUSTER

Implement drawing an EXPLODING CLUSTER card, including that the user must play
a DEBUG card or be out.

Implemement re-inserting the EXPLODING CLUSTER card into the deck.

##### Phase 3.4: Drawing UPGRADE CLUSTER face-down

Implement drawing an UPGRADE CLUSTER card face down, and re-inserting it into
the deck.

Implement face-up vs. face-down for cards in the deck.

Pass the top-of-deck image to clients to render.

##### Phase 3.5: Drawing UPGRADE CLUSTER face-up

Implement drawing an UPGRADE CLUSTER card face up, causing a player to be out.

#### Phase 4: Cards

Implement the card actions.

#### Phase 5: Everything else

Implement the "watch game" logic.

Implement anything else that was detailed in the design doc but not yet
implemented, or which was not thought of during the design phase, but is
actually needed.

## Part 3: Things not yet integrated in this doc
 - Game modifiers (less cards, more/less debug, exploding, upgrade cards, etc)
 - 3 card combos
 - Game PIN required to join
