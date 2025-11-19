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
other players can join the game.  All game state is stored on the server.  The
client is a web app which runs in the browser and has minimal state.  The
server must communicate state and events to clients, including what cards that
player holds, what other players are in the game, whose turn it is, and what
cards are being played.

The server can support many games at once.  Each game must be totally
independent from all other games.  Each game can support 2 to 5 players.  A
game cannot be started with less than 2 players, and if player leave the game
such that there are less than 2 players remaining, the game ends.

The server can run on any port, and when a client connects to that port, it
knows to keep using the same port number for the rest of the game.

Every time the server state changes, all clients get a message with an updated
nonce.

When a user joins the game, their session is associated with that game. If they
close their browser or navigate away, they are removed from the game.  If they
reload the page they can rejoin ONLY if the nonce they last received matches
the current nonce on the server.  If the nonce does not match, they can't
rejoin the game - they must start over.

When a user leaves a game, their cards are help in reserve until the server
nonce changes.  Once it changes, those cards are removed from the game (neither
in the draw pile nor the discard pile), but the game should continue as long as
there are at least 2 players.  When the game ends or the last player leaves,
all state for that game must be purged from the server.

The server should support a URL "/infoz" which produces an HTML page with a
link to each current game at "/infoz/game/{game-code}".  Clicking the link
takes you to the info page for a single game which shows:
  * The list of players and their hands (text only)
  * The draw pile (text only) 
  * The discard pile (text only)
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
swear words. The player is then taken to the "control panel" screen.  They can
see the game code and share it with friends. This player is the game creator.

### Joining a game

If the user chooses "Join a game", we ask them for a game code and their name.
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

If the user chooses "Watch a game", we we look for a game with that game code.
If found, we take them to an "observer" screen.

### Starting a game

The "control panel" and the "lobby" screen are the same, except that the control
panel shows a "Start game" button, while the lobby shows a "Waiting for the game
to start" message.  Both show a list of the joined players and how many people
are watching the game.

The player who created the game can click the start button in the control panel
to begin the game. If there are less than 2 players, the game cannot be
started. Once a game is started, no more users can join, but more people can
watch.

When the control panel user starts the game, all players see the lobby screen
change to the "game" screen. The "observer" screen is the same as the "game"
screen, but the hand area (which will defined later) is removed.

### Game state

The server needs to track two main sets of cards.

First is the "draw pile", sometimes called "the deck".  This is the set of
cards from which players draw cards.  Cards in this pile are usually face-down,
but some cards (which will be defined later) may be face-up, so the server
must track that.  This pile can be shuffled, inspected, and cards can be
inserted into specific locations in it.

Second is the "discard pile".  This is where cards are played, face-up.  The
discard pile is empty at the start of the game.

The server also needs to track the "pending operations" stack, which is used to 
track what operations need to be performed.

The server also needs to track the list of players, and whose turn it is now.

#### Per-player state

Each player who is not "out" has a set of 0 or more cards, called their "hand".
The server needs to keep track of each player's hand.  It is positional, which
will be important later, and the users can reorder the cards within their hand
as they see fit.  Whenever a player plays a card, we need to verify that they
actually have that card in their hand first, to prevent abuse.

Clients should never have any information about the game except:
  * What cards are in their hand
  * What is showing on the top of the draw pile
  * What is showing on the top of the discard pile
  * The random-ordered list of players, and how many cards each player has
  * Whose turn it is now
  * Whose turn is next
  * The reaction timer, when needed
  * The number of turns the current player must take, when needed

### Playing the game

#### The game screen

The main "game" screen is split into several areas:
  * On the top left is the "player list" area, which shows all the players and
    their card counts. It highlights the player whose turn it is in light
    green, and whose turn is next in light orange.  The order of players is
    randomized at the start of the game, but all players see the same order.

  * Below the player list is an area which shows the reaction timer when
    needed.  We will call this the timer area.  More on that later.

  * To the right of those is the "table" area. It shows the draw pile on the
    left and the discard pile on the right. If either pile is empty, show a
    yellow-orange outline instead. Both piles, and their outlines, should be as
    large as possible in that area. Both piles are always the same size.

  * Below those, across the whole screen, is the "message" area.  It has two
    parts.
    - At the top is a line showing information about whose turn it is.
    - Below that is the log.  It is at least 3 text lines tall.  When we talk
      about sending a message to players, this is where the message goes.  It
      is a log, so new messages are always appended to the bottom, and the
      bottom is visible, while the top scrolls off, unless users choose to
      scroll back.

  * Below that, across the whole screen, is the "hand" area, which will show a
    player's cards.  If the player has a lot of cards they can be rendered
    smaller or wrapped to multiple lines.

#### Turns

The game is played in turns.  At the beginning a random player is chosen to
start.  After that, play proceeds in order of the player list.

##### Message area - whose turn is it

For the player whose turn it currently is, the top line of the message area
shows "It's your turn", highlighted light green like the player list.

For the player whose turn is next, it shows "Your turn is next", highlighted
light orange like the player list.

For all other players it shows "It's {player}'s turn", highlighted light grey.

##### Playing cards

A player 's turn consists of two phases - playing cards, and drawing a card.
Unless a card's rules specifically say otherwise, the player must draw a card
to end their turn.

During their turn, the player may play 0 or more cards, either one at a time or in
combos.  To play a card, players drag and drop them from their hand into
discard pile.  Once played, and the reactions are done, any card-specific rules
or actions must be followed (more on that later).  When a player decides they
are done playing, they must draw a card from the draw pile, unless the last
card action they played specifically said they do not need to draw a card.

When a player plays one or more cards, those cards are removed from the
player's hand in the server state and in their hand area, and all players can
see the last played card on the discard pile.  We send a message to all players
that "{player} played a {card-class} card".  The card class is always in capital
letters.  If they played a pair of cards as a combo, the message is "{player}
played a pair of {card-class} cards".

##### Drawing a card

When a player draws a card by clicking on the draw pile, they see the top
card as a large overlay for 3 seconds.  If it is a regular card (not "EXPLODING
CLUSTER" or "UPGRADE CLUSTER"), that card goes into theirt hand on the server
and in their hand area, and their turn is over.

When a player draws a card by clicking on the draw pile, other players see the
draw pile flash yellow twice before the player list updates whose turn it it.
We send a message to all players that "{player} drew a card", but not which
card they drew.

##### Drawing an EXPLODING CLUSTER card

If the player draws an "EXPLODING CLUSTER" card, the current player sees that
card as a large overlay for 3 seconds, and then it is shown on the discard
pile.  Regular play pauses.  All other players see it as a large overlay until
play resumes.

If the player does not have a DEBUG card, they out of the game, and do not get
any more turns.  The player list is updated with a strike-through on their
name.  Send a message to all players that "{player}'s cluster exploded!". All
the cards in their hand plus the EXPLODING CLUSTER card are removed from the
duration of the game.  Play then continues with the next player's turn.

If the player has one or more DEBUG cards, they must now play a DEBUG card, and
only a DEBUG card, by dragging and dropping from their hand onto the discard
pile. DEBUG cards cannot be NAKed by another player.  There is no reaction
allowed.

The player must then re-insert the EXPLODING CLUSTER card back into the draw
pile at any position they choose.  They are prompted to choose a position,
like: "There are {n} cards in the draw pile, where do you want to put the
EXPLODING CLUSTER card? (0 is the top of the deck, {n} is the bottom)". They
need to enter a number from 0 to N, and whatever they enter, we put the
EXPLODING CLUSTER card back into the draw pile at that position. If they chose
0, the card goes on the top of the draw pile.  If they chose {n}, the card goes
at the bottom of the draw pile.

Once the EXPLODING CLUSTER card is re-inserted into the deck, the player's turn
is over and it becomes the next player's turn.

##### Drawing a face-down UPGRADE CLUSTER card

If the player draws an "UPGRADE CLUSTER" card, the current player sees that
card as a large overlay for 3 seconds, and then it is shown on the discard
pile.  Regular play pauses.  All other players see it as a large overlay until
play resumes.

The player must then re-insert the UPGRADE CLUSTER card back into the draw pile
at any position they choose.  Unlike EXPLODING CLUSTER cards, the UPGRADE
CLUSTER card is re-inserted face-up.  The player is prompted to choose a
position, like: "There are {n} cards in the draw pile, where do you want to put
the UPGRADE CLUSTER card? (0 is the top of the deck, {n} is the bottom)". They
need to enter a number from 0 to N, and whatever they enter, we put the UPGRADE
CLUSTER card back into the draw pile at that position. If they chose 0, the
card goes on the top of the draw pile.  If they chose {n}, the card goes at the
bottom of the draw pile.

Once the UPGRADE CLUSTER card is re-inserted into the deck, the player's turn
is over and it becomes the next player's turn.

##### Drawing a face-up UPGRADE CLUSTER card

If the player draws a face-up UPGRADE CLUSTER card, all players see that cards
as a large overlay for 3 seconds. After that, the currect player is out of the
game, and it is the next player's turn.  There is no reaction allowed.

##### Winning

When there is only one player left, that player wins.  Send a message to all
players that "{player} wins!", and halt the game.

#### UI: the "hand" area

##### Reordering cards

If the player drags and drops cards within their hand, the cards should be
reordered on the server and rendered for that player.  This can happen at any
time, even when it is not that player's turn.

##### Playable and unplayable cards

Each card has some time periods where is is playable and some where it is not,
which will be detailed later.

Playable cards should be rendered as per their image.

Unplayable cards should be rendered as per their image, but slightly faded out.

These rules apply to all time periods.

"Now" cards are playable during other players turns.

If someone tries to drag an unplayable card to the discard pile, it should have
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

If a player single-clicks a playable card in their hand, that selects the card
- put a blue outline around it. If they single click an already-selected card a
second time, it de-selects the card, remove the outline (or change it to the
background color).

If a player single-clicks an unplayable card in their hand, do nothing.

If a player single-clicks a playable card (making it selected) and then clicks
another playable card, do not select the second card.  The only exception to
this is DEVELOPER cards.  If the player selects a DEVELOPER card, and then
selects a second, identical card (both DEVELOPER cards with the same name), we
call that a valid combo.  In that case, select (outline) both cards.

For example:
  * Click NAK - select the card
  * Click SHUFFLE - do not select the card
  * Click another NAK - do not select the card
  * Click the first NAK again - deselect the card
  * Click DEVELOPER "foo" - select the card
  * Click SHUFFLE - do not select the card
  * Click DEVELOPER "bar" - do not select the card (not the same card name)
  * Click DEVELOPER "foo" - select the second card (valid combo)

##### Playing cards

If there are no cards selected and the player clicks and drags a card to the
discard pile, that card is played.

If there is a single card selected and the player clicks and drags the selected
card to the discard pile, that card is played.

If there is a single card selected and the player clicks and drags a different
card to the discard pile, the selected card is deselected and the second card
is played.

If there is a single DEVELOPER card selected and the player clicks and drags
another identical card to the discard pile, that is considered a valid combo,
and both cards are played.

If there is a valid combo of DEVELOPER cards selected and the player clicks and
drags one of those cards to the discard pile, both cards are played.

If a single DEVELOPER card is played, but that card is required to be in a
combo (a pair), do not play that card.  Return it to the player's hand with a
message that "DEVELOPER cards must be played as pairs".

If there is a valid combo of cards selected and the player clicks and drags a
different card to the discard pile, that does not play any card, but the
outline of the selected cards should flash 3 times.

When a card or a combo is played, remove the card or cards from the player's
hand, and put them on the discard pile.  All players should see the top card of
the discard pile and receive a message about what was played.

##### Inspecting cards

If the player double clicks a card in their hand, show that card in a large
overlay, until the player clicks somewhere or hits the escape key.

#### UI: The table area

The table area is green like a blackjack table, with the draw pile and the
discard pile centered on it, left-to-right. If either pile is empty, show a
yellow-orange outline instead.

The draw pile and the discard pile, or their outlines should be rendered as large as possible, but
they must always be the same size.

#### Beginning the game

At the beginning of the game, when the "start game" is clicked, remove all of
the "EXPLODING CLUSTER" and "UPGRADE CLUSTER" and "DEBUG" cards from the deck.

Each player gets 1 DEBUG card in their hand. Put 2 DEBUG cards back into the
deck, or 1 DEBUG card if that is all that is left. Shuffle the deck.

Each player gets 7 more cards from the deck, for a total of 8.

Once those are assigned, put one less than the number of players "EXPLODING
CLUSTER" cards into the deck. For example, if there are 3 players, put 2
EXPLODING CLUSTERS cards in. If there are 5 players, put 4 in. If there are 3
or 4 players put 1 "UPGRADE CLUSTER" card into the deck. If there are players,
put 2 "UPGRADE CLUSTER" cards in. Shuffle the deck.

That is the draw pile.  Render it on the table area.  The initial discard pile
is empty.

The game has an undocumented URL parameter "dev". If it is set to 1 when the
game is created, then the draw pile should always start with an EXPLODING
CLUSTER card on top. Make sure that the dev param is passed from the main
landing page to the create and join pages, an then to the game page.  Do not
offer the "dev" param through the UI at all.

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

If, during the reaction period, another player plays a "now" card the timer is
reset to 8 seconds and it becomes the rereaction period.  During rereaction any
player, including the current player, may play another "now" card.  Every time
a card is played, the timer is restarted.  If the current player plays it
becomes a "reaction" period.  If any other player plays it becomes a
"rereaction" period.

When the timer finally expires the played cards are executed and it becomes the
"action" period again.

That cycle repeats until the player draws a card.  Every time the timer is
restarted, it is set to 8 seconds.

#### Race condition: two players playing at the same time

If two players try to play a card at the same time (within 2 seconds of each
other), the server must accept the first played card, and reject any other
cards played, with a message like "{player} played a {card-class} card".

##### Example of turns and the action/reaction/rereaction logic

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
      - Timer expires
    - Begin another action period
      - Player A draws a card
      - Their turn turn is over

  * Player B's turn
    - Begin action period
      - Player B plays a PUNCH card
    - Begin reaction period, start timer
      - Player A plays a BLOCK card
    - Begin rereaction period, restart timer
      - Player C plays a BLOCK card
    - Still rereaction period, restart timer
      - Player B plays a BLOCK card
    - Begin another reaction period, restart timer
      - Player A plays a CHEAT card
    - Begin rereaction period, restart timer
      - Timer expires
    - Begin another action period
      - Player B draws a card, it is an EXPLODING CLUSTER card
    - Begin exploding period
      - Other players cannot to anything
      - Player B plays a DEBUG card
      - Player B reinserts the EXPLODING CLUSTER card into the deck
      - Their turn is over

  * Player C's turn
    - Begin action period
      - Player A plays a CHEAT card
      - Player C plays PUNCH card
    - Begin reaction period, start timer
      - Player A plays a BLOCK card
    - Begin rereaction period, restart timer
      - Timer expires
    - Begin another action period
      - Player C draws a card, it is an EXPLODING CLUSTER card
      - They do not have a DEBUG card
      - They are out of the game

  * Player A's turn (again)

##### What cards can be played in which periods

All the cards will be defined in a later section of this doc. This section will
define when cards can be played.

Each card has some periods where is is playable.  Most cards are playable by a
player only during their own turn's action period.  Some cards are playable by
a player only during their own turn's action period, but only in pairs.  Some
cards are only playable while that player is exploding.

Some cards are considered "now" cards and are playable by the current player
during action or rereaction or by any other player during action, reaction, or
rereaction.

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
    now: true
    combo: false
    count: 1

  - class: NAK
    name: kelsey
    image: ./cards/nak_-_kelsey.png
    now: true
    combo: false
    count: 1

  - class: NAK
    name: next_release
    image: ./cards/nak_-_next_release.png
    now: true
    combo: false
    count: 1

  - class: NAK
    name: prs_welcome
    image: ./cards/nak_-_prs_welcome.png
    now: true
    combo: false
    count: 1

  - class: NAK
    name: slash_close
    image: ./cards/nak_-_slash_close.png
    now: true
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
action/reaction/rereaction loop described above.

EXPLODING CLUSTER cards have already been detailed.

DEBUG cards have already been detailed.

Playing a NAK card pops 1 extra item off the operations stack, if possible,
and discards it.  If the stack was empty this card does nothing.  Playing a NAK
after a NAK negates the first NAK.

Playing a SHUFFLE card shuffles the draw pile and send a message to all players
that "The deck was shuffled".

SHUFFLE NOW cards are the same action as SHUFFLE cards, but may be played by
any player during any action, reaction, or rereaction period.

Playing a SEE THE FUTURE card shows the current player the top 3 cards from the
draw pile in a large overlay, with a "Done" button.  When the player clicks
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
position flashes 3 times and then disappeard.  It is moved to the current
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
of great comments.

This game will run on Linux.

It should use all modern best practices.  If you think there is a better way to
do something, you must ask me, but I want you to tell me what you think is good
technology for this app.

It must have robust unit tests to ensure no regressions as we make progress.
Every major piece of logic must have tests, and those tests must pass.  To run
`npm` tests, always invoke it like `npm test -- --no-watch` so that it runs
once and exits with a proper exit code.

This app should emit useful debugging logs, which can be used by humans or AIs
when we hit a problem.  Make sure to include the game code in every log-line
that relates to a game.  Add a flag or parameter which enables verbose logging,
which includes logging every message sent and received by the server and
client.

Always try to make the smallest possible change to implement a feature.  Avoid
big changes that do many things at once.

Do not generate files that are not needed.  I use `vim` for editing and `git`
for source control.

### UI

The web UI for this app must be beautiful and modern, very reactive and
interactive, and as simple as possible to use.  Don't use tiny text or buttons.
Make it beautiful with good sized text and ample spacing.  Use modern web UI
styles and techniques.

A prototype UI exists in ./prototype -- copy that UI design where possible.

### Stages

#### Stage 1: Server and client

Implement the server and client skeletons, with no game logic.

Implement the WebSocket connection between the client and server, with
heartbeats to detect disconnects.

Implement logging and infoz.

Implement the landing, lobby, create game, and join game pages.

Implement the "start game" and "join game" logic.

Implement the game page with the basic layout, but no game logic.

Implement the player list, message area, timer area, table area, and hand area.

#### Stage 2: Hand and table UI

Implement drag and drop reordering of cards within the hand area.

Implement card selection, including multi-card combos.

Implement drag and drop of cards from the hand area to the discard pile.

Implement drawing cards from the draw pile.

Implement the large overlay for inspecting cards.

#### Stage 3: Turns

Implement the turn logic, including the action/reaction/rereaction logic.

Implement the operations stack.

Implement playable and unplayable cards and their rendering.

Implement drawing EXPLODING CLUSTER and UPGRADE CLUSTER cards, and re-inserting
them into the deck.

#### Stage 4: Cards

Implement the card actions.

#### Stage 5: Everything else

Implement the "watch game" logic.

Implement anything else that was detailed in the design doc but not yet
implemented, or which was not thought of during the design phase, but is
actually needed.
