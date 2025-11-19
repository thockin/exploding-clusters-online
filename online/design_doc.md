# Exploding Clusters design doc

## Objective

We are building an online web game. It is a version of the game "Exploding
Kittens", but our game is called "Exploding Clusters".

As much as possible, we want to keep this design doc in sync with the code as
we evolve it.

## Critical constraints

This app is to be written in modern Node.js, using Next.js, React, and
typescript. It is critical that this code be modern, high quality and have lots
of good comments.  It should use all modern best practices.  If you think there
is a better way to do it, you must ask me, but I want you to tell me what you
think is good technology for this app.

It must have robust unit tests to ensure no regressions as we make progress.
Every major piece of logic must have tests, and those tests must pass.  To run
`npm` tests, always invoke it like `npm test -- --no-watch` so that it runs
once and exits with a proper exit code.

This app should emit useful debugging logs, so I can give them back to you when
we hit a problem.  Make sure to include the game code in every log-line that
relates to a game.

## UI

The web UI for this app must be beautiful and modern, very reactive and
interactive, and as simple as possible to use.  Don't use tiny text or buttons.
Make it beautiful with good sized text and ample spacing.  Use modern web UI
styles and techniques.

## The server and the client

The server can support many games at once.  Each game must be totally
independent from all other games.  Each game can support 2 to 5 players.  A
game cannot be played with less than 2 players.

The server can run on any port I choose, and when a client connects to that
port, it knows to keep using the same port number.

When a user joins the game, their session is associated with that game.  If
they close their browser, they are removed from the game.  If they reload the
page, they can't rejoin the game - they must start over.

When a user leaves a game, their cards are removed from the game, but the game
should continue as long as there are at least 2 players.  When the game ends or
the last player leaves, purge all state for that game from the server.

The server should support a URL "/infoz" which produces an HTML page with a
link to each current game at "/infoz/game/<game code>".  Clicking the link
takes you to the info page for a single game which shows:
  * The list of players and their hands (text only)
  * The draw pile (text only) 
  * The discard pile (text only)
  * Whose turn it is
  * The timestamp this data was loaded

The infoz page is only for debugging and is not linked from anywhere in the
app.  It does not need to be dynamic - it can be a static snapshot of the game
state when the page wass loaded.

## Creating a game

To begin, a user connects to the app and gets a choice "Create a new game",
"Join a game", or "Watch a game".

If they choose "Create a new game" we ask them their name, and then create a
new game instance on the server with a randomized "game code" which is exacty 5
letters, alphabetic, no vowels, upper-case, and  does not contain swear words.
The player is then taken to the "control panel" screen.  They can see the game
code and share it with friends. This player is the game creator.

If the user chooses "Join a game" we ask them for a game code and their name.
When they type in a game code, we try to join that game.  Befor they can join:
  * First look for a game with that game code on the server.  If no such game code
    is found on the server, we tell them "Game <code> does not exist", and leave
    them at the landing page.

  * If the game code is found, check if the game has 5 users, and if so tell
    them "Sorry, that game is full", and leave them at the landing page.

  * If there is room for them, check if that name is already used in the game,
    and if so, ask them to pick a different name.

  * If they have a valid game code which exists on the server, and there is room
    for them, and their name is unique, add them to that game's "lobby" screen.

If the user chooses "Watch a game", we we look for a game with that game code.
If found, we take them to an "observer" screen.

The "control panel" and the "lobby" screen are the same, except that the control
panel shows a "Start game" button, while the lobby shows a "Waing for the game
to start" message.  Both show a list of the joined players and how many people
are watching the game.

The player who created the game can click the start button in the control panel
to begin the game. If there are less than 2 players, the game cannot be
started. Once a game is started, no more users can join, but more people can
watch.

When the control panel user starts the game, the lobby screen changes to the
"game" screen for all players. The "observer" screen is the same as the
"game" screen, but the hand are (defined later) is empty.

## Game state

On the server we need to keep track of each user's hand of cards.  It is
positional, which will be important later, and the users can reorder the cards
in their hand as they see fit.  Whenever a user plays a card, we need to verify
that they actually have that card in their hand first, to prevent abuse.

The server also needs to track a "draw" pile, sometimes called "the deck" and a
"discard" pile.  The discard pile is empty at the start of the game.

Clients should never have any information about the game except:
  * What cards are in their hand
  * What is showing on the top of the draw pile
  * What is showing on the top of the discard pile
  * The names of the other players and how many cards each player has
  * Whose turn it is now
  * Whose turn is next

## The game

### The game screen

The "game" screen is split into several areas:
  * On the top left is the player list area, which shows all the players and
    their card counts, highlights the player whose turn it is in light green,
    and whose turn is next in light orange.  The order of players is
    randomized, but all players see the same order.
  * Below the player list is an area which shows the reaction timer when
    needed.  Call this the timer area.  More on that later.
  * To the right of those is the table area.  It is green like a blackjack
    table and shows the draw pile on the left and the discard pile on the
    right. If either pile is empty, show a yellow-orange outline instead.
    Both piles, and their outlines, should be as large as possible in that
    area.
  * Below those, across the whole screen, is the message area.  It has two
    parts.
    - At the top is a line showing information about whose turn it is.
    - Below that is the message area.  It is at least 3 text lines tall.  When
      we talk about sending a message to players, this is where the message
      goes.  It is a log, so new messages are always appended to the bottom,
      and the bottom is always visible.  Users can choose to scroll up.
  * Below that, across the whole screen, is the hand area, which will show my
    cards.  If a player has a lot of cards you can make them smaller or wrap to
    multiple lines.

### Game play

The game is played in turns.  At the beginning a random player is chosen to
start.  After that, play proceeds in order of the player list.

#### Message area - whose turn is it

For the player whose turn it currently is, the top line of the message area
shows "It's your turn".  For the player whose turn is next, it shows "Your turn
is next".  For all other players it shows "It's <player>'s turn".

If it is my turn, that line is highlighted light green like the player list.
If it is my turn next, that line is highlighted light orange like the player
list. Otherwise that line is highlighted light grey.

#### Playing cards

During a turn, a player may play 0 or more cards, either one at a time or in
valid pairs, by dragging and dropping them in the discard pile, and following
any card-specific rules (more on that later).  When a player decides they are
done playing, they must draw a card from the draw pile.

When a player plays one or more cards by dragging them from their hand to the
discard pile, those cards are removed from the player's hand on the server (and
rendered for the player), and all players can see the card(s) on the discard
pile.  We send a message to all players that "<player> played a <card type>
card".  The card type is always in capital letters.  If they played a pair of
cards, the message is "<player> played a pair of <card type> cards".

#### Drawing a card

When a player draws a card by clicking on the draw pile, they get that card
If they draw an "EXPLODING CLUSTER" card, they must play a DEBUG card, again by
dragging and dropping it on the discard pile, at which point their turn is over
and it becomes the next player's turn. If they do not have a DEBUG card, they
explode and are out of the game, and do not get any more turns.  If they draw a
face-up "upgrade cluster" card, they are out of the game, and it is the next
player's turn.  If they draw anything else, the card goes into their hand, and
it comes the next player's turn.

When a player draws a card by clicking on the draw pile, other players see the
draw pile flash twice before the player list updates whose turn it it.  We send
a message to all players that "<player> drew a card", but not which card they
drew.

#### Exploding clusters

When a player draws an EXPLODING CLUSTER card, that card is shown to all
players on the discard pile, but is not actually discarded.  We also send a
message to all players that "<Player> drew an EXPLODING CLUSTER!".  If the
player does not have a DEBUG card, send a message to all players that
"<player>'s cluster exploded!" and grey-out their name in the player list.  All
the cards in their hand plus the EXPLODING CLUSTER card are removed from the
duration of the game.

If they do have a DEBUG card, they must play it by dragging it to the discard
pile, at which point they get to re-insert it into the draw pile.  Tell them
"There are <N> cards in the draw pile, where do you want to put the EXPLODING
CLUSTER card? (0 is the top of the deck, <N> is the bottom)". They need to
enter a number from 0 to N, and whatever they enter, we put the EXPLODING
CLUSTER card back into the draw pile at that position. If they chose 0, the
card goes on the top of the draw pile.  If they chose <N>, the card goes at the
bottom of the draw pile.

#### Playable and unplayable cards

Each card has some periods where is is playable and some where it is not.  We
wil detail this later. Playable cards should be rendered as per their image.
Unplayable cards should be rendered as per their image, but slightly faded out.
This applies to all time periods.

If someone tries to drag an unplayable card to the discard pile, it must not be
played.

#### Winning

When there is only one player left, that player wins.  Send a message to all
players that "<player> wins!", and halt the game.

### Details on the "hand" area UI

#### Rendering

Always render playable and unplayable cards in the order the user has sorted
them in their hand. Playable cards are rendered normally.  Unplayable cards are
rendered slightly faded out.

Never overflow horizontally if there are too many cards to fit.  Instead, wrap
to multiple lines as needed, and make the cards smaller.

When adding an outline to a card, the other cards should not move.  Make sure
that is always true.

#### Selecting cards

If a player single-clicks a playable card in their hand, that selects the card
- put a blue outline around it. If they single click an already-selected card a
second time, it de-selects the card, remove the outline.

If a player single-clicks an unplayable card in their hand, do nothing.

If a player clicks a playable card (becoming selected) and then clicks another
playable card, do not select the second card.  The only exception to this is
DEVELOPER cards.  If the player selects a DEVELOPER card, and then selects a
second, identical card (both DEVELOPER cards with the same name), we call that a
valid combo.  In that case, select (outline) both cards.

For example:
  * Click NAK - select the card
  * Click SHUFFLE - do not select the card
  * Click another NAK - do not select the card
  * Click the same NAK - deselect the card
  * Click DEVELOPER "foo" - select the card
  * Click SHUFFLE - do not select the card
  * Click DEVELOPER "bar" - do not select the card (not the same card name)
  * Click DEVELOPER "foo" - select the second card (valid combo)

#### Playing cards

If there are no cards selected and the player clicks and drags a card to the
discard pile, that card is played.

If there is a single card selected and the player clicks and drags the selected
card to the discard pile, that card is played.

If there is a single card selected and the player clicks and drags an identical
other card to the discard pile, that is considered a valid combo, and both
cards are played.

If there is a valid combo of cards selected and the player clicks and drags one
of those cards to the discard pile, both cards are played.

If a single card is played, but that card is required to be in a combo (a
pair), do not play that card.  Return it to the player's hand.

When a card or a combo is played, remove it from the player's hand, show it
full-size on the discard pile for all players, and send a message to all
players.

If there is a single card selected and the player clicks and drags a different card to the
discard pile, that does not play any card, but the outline of the selected card
should flash 3 times.

If there is a valid combo of cards selected and the player clicks and drags a
different card to the discard pile, that does not play any card, but the
outline of the selected cards should flash 3 times.

#### Inspecting cards

If the player double clicks a card in their hand, show that card in a large
overlay, until the user clicks somewhere or hits escape.

#### Reordering cards

If the player drags and drops cards within their hand, the cards should be
reordered on the server and rendered for that player.

### Details on the table area

Make the draw pile and the discard pile as large as possible, but they must
always be the same size.

### Beginning the game

At the beginning of the game, when the "start game" is clicked, remove the
"EXPLODING CLUSTER" and "UPGRADE CLUSTER" and "DEBUG" cards from the deck. Each
player gets 1 DEBUG card in their hand. Put 2 DEBUG cards back into the deck,
or 1 DEBUG card if that is all that is left. Shuffle the deck. Each player gets
7 more cards from the deck, for a total of 8. Once those are assigned, put one
less than the number of players "EXPLODING CLUSTER" cards into the deck. For
example, if there are 3 players, put 2 EXPLODING CLUSTERS cards in. If there
are 5 players, put 4 in. If there are 3 or 4 players put 1 "UPGRADE CLUSTER"
card into the deck. If there are players, put 2 "UPGRADE CLUSTER" cards in.
Shuffle the deck.  That is the draw pile.  Render it face down on the table
area.  The discard pile is empty.

The game has an undocumented URL parameter "dev". If it is set to 1 when the
game is created, then the draw pile should always start with an EXPLODING
CLUSTER card on top. Make sure that the dev param is passed from the main
landing page to the create and join pages, an then to the game page.  Do not
offer the "dev" param through the UI at all.

### Taking turns

We need to give players time to react to each other.  Let's define some time
periods, so we can speak about them more precisely.

We call the whole time period from the beginning of a player's turn until they
draw the "turn" period.  If the player draws an EXPLODING CLUSTER card we call
the period until they play a DEBUG card the "exploding" period.

Within the turn period there are smaller sub-periods.  At the beginning of a
players turn, when they need to play a card or draw, we call that the "action"
period.  If the user plays a card during their action period, except for a
DEBUG card, a timer is set and a large 8 second countown is drawn in the timer
area. That period is called the "reaction period".

If nothing else is played by any player, the timer expires, the played cards
are executed (more be low) and it becomes the "action" period again.

If, during the reaction period, another player plays a "now" card the timer is
reset and it becomes the rereaction period.  During rereaction any player,
including the current player may play a "now" card.  Every time a card is
played, the timer is restarted.  If the current player plays it becomes a
"reaction" period.  If any other player plays it becomes a "rereaction" period.
When the timer finally expires the played cards are executed and it becomes the
"action" period again.

That cycle repeats until the user draws a card.

#### Example

Here's an example of the action/reaction/rereaction loop:

  * Player A's turn
    - Begin action period
    - Player A plays a SHUFFLE card
    - Begin reaction period, start timer
    - Timer expires
    - Player A draws a card
    - Their turn turn is over
  * Player B's turn
    - Begin action period
    - Player B plays a combo of DEVELOPER cards
    - Begin reaction period, start timer
    - Player A plays a NAK card
    - Begin rereaction period, restart timer
    - Player C plays a NAK card
    - Still rereaction period, restart timer
    - Player B plays a NAK card
    - Begin reaction period, restart timer
    - Player A plays a SHUFFLE NOW card
    - Begin rereaction period, restart timer
    - Timer expires
    - Player B draws a card, it is an EXPLODING CLUSTER card
    - Begin exploding period
    - Player B plays a DEBUG card
    - Player B reinserts the EXPLODING CLUSTER card into the deck
    - Their turn is over
  * Player C's turn
    - Begin action period
    - Player A plays a SHUFFLE NOW card
    - Player C plays a combo of DEVELOPER cards
    - Begin reaction period, start timer
    - Player A plays a NAK card
    - Begin rereaction period, restart timer
    - Timer expires
    - Player C draws a card, it is an EXPLODING CLUSTER card
    - They do not have a DEBUG card
    - They are out of the game
  * Player A's turn (again)

#### What can be played in which periods

All the cards will be defined later.

Each card has some periods where is is playable.  Some cards are playable by a
player only during their own action period.  Some cards are playable by a player
only during their own action period, but only in pairs.  Some cards are only
playable while that player is exploding.  Some cards are considered "now" cards
and are playable by the current player during action or rereaction or by
another player (not the current player) during action, reaction, or rereaction.

This is tricky logic, so let's describe it in more detail.

Each card has an associated operation which is to be perfomed when the timer
expires. Let's model this as the "pending operations" stack.

Every time a card is played, as per the above rules, we push it onto the stack
and the timer is reset. When the timer finally expires, we need to pop operations until the stack is empty. Pop an item, do the operation, repeat.

Let's do an example. Suppose the "NAK" card's operation is to pop another item from the stack and discard it.

* It is player A's turn
* Player A plays a "SEE THE FUTURE" card (we will define that operation later)
* Push "SEE THE FUTURE" on the stack
* Start the timer
* Player B plays a "NAK" card
* Push "NAK" on the stack
* Restart the timer
* Player A plays a "NAK"
* Push "NAK" on the stack
* Restart the timer
* Player C plays a "SHUFFLE NOW"
* Push "SHUFFlE" on the stack
* Restart the timer
* Timer expires
* Pop an item - it's "SHUFFLE", which means to shuffle the draw pile
* Stack has more items
* Pop an item - it's "NAK", which means to pop another item (a NAK) and discard it
* Stack has more items
* Pop an item - it's "SEE THE FUTURE"
* Do "SEE THE FUTURE" (will be defined later)
* No more items on the stack
* Player A may play again or draw to end his turn

## Cards

The full deck is comprised of 66 cards
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
same back image, stored in a file
`/home/thockin/exploding_clusters_online/cards/back.png`.

Each card has a type, a name, an image, a flag indicating if it is a "now card or
not, a flag indicating if it must be played as a pair or not, and a count of
how many copies of this card are in the deck. Each type of card also has a
different action, which will be detailed after the YAML.

All the cards will be detailed in the following YAML document.  It is YAML for
clarity, I don't need it to be YAML in the server.

```
cards:
  - type: EXPLODING CLUSTER
    name: broken_logo
    image: /home/thockin/exploding_clusters_online/cards/exploding_-_broken_logo.png
    now: false
    pair: false
    count: 1

  - type: EXPLODING CLUSTER
    name: deathstar
    image: /home/thockin/exploding_clusters_online/cards/exploding_-_deathstar.png
    now: false
    pair: false
    count: 1

  - type: EXPLODING CLUSTER
    name: ghost
    image: /home/thockin/exploding_clusters_online/cards/exploding_-_ghost.png
    now: false
    pair: false
    count: 1

  - type: EXPLODING CLUSTER
    name: phippy
    image: /home/thockin/exploding_clusters_online/cards/exploding_-_phippy.png
    now: false
    pair: false
    count: 1

  - type: UPGRADE CLUSTER
    name: logos1
    image: /home/thockin/exploding_clusters_online/cards/upgrade_-_logos1.png
    now: false
    pair: false
    count: 1

  - type: UPGRADE CLUSTER
    name: logos2
    image: /home/thockin/exploding_clusters_online/cards/upgrade_-_logos2.png
    now: false
    pair: false
    count: 1

  - type: ATTACK
    name: bikeshed
    image: /home/thockin/exploding_clusters_online/cards/attack_-_bikeshed.png
    now: false
    pair: false
    count: 1

  - type: ATTACK
    name: dash_dash_force
    image: /home/thockin/exploding_clusters_online/cards/attack_-_dash_dash_force.png
    now: false
    pair: false
    count: 1

  - type: ATTACK
    name: push_on_friday
    image: /home/thockin/exploding_clusters_online/cards/attack_-_push_on_friday.png
    now: false
    pair: false
    count: 1

  - type: ATTACK
    name: use_latest
    image: /home/thockin/exploding_clusters_online/cards/attack_-_use_latest.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: cpr
    image: /home/thockin/exploding_clusters_online/cards/debug_-_cpr.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: elementary
    image: /home/thockin/exploding_clusters_online/cards/debug_-_elementary.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: git_bisect
    image: /home/thockin/exploding_clusters_online/cards/debug_-_git_bisect.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: roll_it_back
    image: /home/thockin/exploding_clusters_online/cards/debug_-_roll_it_back.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: silence
    image: /home/thockin/exploding_clusters_online/cards/debug_-_silence.png
    now: false
    pair: false
    count: 1

  - type: DEBUG
    name: swarm
    image: /home/thockin/exploding_clusters_online/cards/debug_-_swarm.png
    now: false
    pair: false
    count: 1

  - type: FAVOR
    name: code_review
    image: /home/thockin/exploding_clusters_online/cards/favor_-_code_review.png
    now: false
    pair: false
    count: 2

  - type: FAVOR
    name: cut_paste
    image: /home/thockin/exploding_clusters_online/cards/favor_-_cut_paste.png
    now: false
    pair: false
    count: 2

  - type: NAK
    name: backlog
    image: /home/thockin/exploding_clusters_online/cards/nak_-_backlog.png
    now: true
    pair: false
    count: 1

  - type: NAK
    name: kelsey
    image: /home/thockin/exploding_clusters_online/cards/nak_-_kelsey.png
    now: true
    pair: false
    count: 1

  - type: NAK
    name: next_release
    image: /home/thockin/exploding_clusters_online/cards/nak_-_next_release.png
    now: true
    pair: false
    count: 1

  - type: NAK
    name: prs_welcome
    image: /home/thockin/exploding_clusters_online/cards/nak_-_prs_welcome.png
    now: true
    pair: false
    count: 1

  - type: NAK
    name: slash_close
    image: /home/thockin/exploding_clusters_online/cards/nak_-_slash_close.png
    now: true
    pair: false
    count: 1

  - type: SEE THE FUTURE
    name: dashboard
    image: /home/thockin/exploding_clusters_online/cards/see_future_-_dashboard.png
    now: false
    pair: false
    count: 1

  - type: SEE THE FUTURE
    name: date_driven
    image: /home/thockin/exploding_clusters_online/cards/see_future_-_date_driven.png
    now: false
    pair: false
    count: 1

  - type: SEE THE FUTURE
    name: dry_run
    image: /home/thockin/exploding_clusters_online/cards/see_future_-_dry_run.png
    now: false
    pair: false
    count: 1

  - type: SEE THE FUTURE
    name: learn_from_past
    image: /home/thockin/exploding_clusters_online/cards/see_future_-_learn_from_past.png
    now: false
    pair: false
    count: 1

  - type: SEE THE FUTURE
    name: release_notes
    image: /home/thockin/exploding_clusters_online/cards/see_future_-_release_notes.png
    now: false
    pair: false
    count: 1

  - type: SHUFFLE
    name: double_trouble
    image: /home/thockin/exploding_clusters_online/cards/shuffle_-_double_trouble.png
    now: false
    pair: false
    count: 1

  - type: SHUFFLE
    name: node_failure
    image: /home/thockin/exploding_clusters_online/cards/shuffle_-_node_failure.png
    now: false
    pair: false
    count: 1

  - type: SHUFFLE
    name: rolling_update
    image: /home/thockin/exploding_clusters_online/cards/shuffle_-_rolling_update.png
    now: false
    pair: false
    count: 1

  - type: SHUFFLE NOW
    name: eventually_consistent
    image: /home/thockin/exploding_clusters_online/cards/shuffle_now_-_eventually_consistent.png
    now: true
    pair: false
    count: 1

  - type: SKIP
    name: oncall
    image: /home/thockin/exploding_clusters_online/cards/skip_-_oncall.png
    now: false
    pair: false
    count: 1

  - type: SKIP
    name: ooo
    image: /home/thockin/exploding_clusters_online/cards/skip_-_ooo.png
    now: false
    pair: false
    count: 1

  - type: SKIP
    name: tech_debt
    image: /home/thockin/exploding_clusters_online/cards/skip_-_tech_debt.png
    now: false
    pair: false
    count: 1

  - type: SKIP
    name: unicorn
    image: /home/thockin/exploding_clusters_online/cards/skip_-_unicorn.png
    now: false
    pair: false
    count: 1

  - type: DEVELOPER
    name: firefighter
    image: /home/thockin/exploding_clusters_online/cards/developer_-_firefighter.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: grumpy_greybeard
    image: /home/thockin/exploding_clusters_online/cards/developer_-_grumpy_greybeard.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: helper
    image: /home/thockin/exploding_clusters_online/cards/developer_-_helper.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: intern
    image: /home/thockin/exploding_clusters_online/cards/developer_-_intern.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: logical
    image: /home/thockin/exploding_clusters_online/cards/developer_-_logical.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: nit_picker
    image: /home/thockin/exploding_clusters_online/cards/developer_-_nit_picker.png
    now: false
    pair: true
    count: 4

  - type: DEVELOPER
    name: prow_robot
    image: /home/thockin/exploding_clusters_online/cards/developer_-_prow_robot.png
    now: false
    pair: true
    count: 4
```

Each card has a unique "full name" which is "`{<type>, <name>, <ordinal>}`",
for example the first "logical" DEVELOPER card is `{DEVELOPER, logical, 0}` and
the third "intern" DEVELOPER card is `{DEVELOPER, intern, 2}`.  This is
important to identify cards uniquely in the server.

You must copy the card images into a place in this repository that makes sense,
so they can be served to the client.

### Actions for each card type

Actions are only performed when the reaction timer expires, as per the
action/reaction/rereaction loop described above.

EXPLODING CLUSTER cards have already been detailed.

DEBUG cards have already been detailed.

Playing a NAK card pops an extra item off the operations stack, if possible,
and discards it.  If the stack was empty this card does nothing.

Playing a SHUFFLE card shuffles the deck and send a message to all players that
"The deck was shuffled".

SHUFFLE_NOW cards are the same action as SHUFFLE cards.

Playing a SEE THE FUTURE card shows the current player the top 3 cards from the
draw pile in a large overlay, with a "Done" button.  When the user click
"done", the overlay is closed, but the cards remain in their places in the
deck. A message is sent to all players that "<player> saw the future".

Playing a FAVOR card pops up a dialog asking the current player to choose one
of the other remaining players, lets call that the victim.  The victim gets a
message saying "<player> asked you for a favor" and to all other players saying
"<player> asked <victim> for a favor".  Victim must choose a card to give to
the current player, which is moved from victim's hand to the current player's
hand.

DEVELOPER cards must be played in pairs.  Playing a DEVELOPER pair pops up a
dialog asking the current player to choose one of the other remaining players,
lets call that the victim.  Then they are asked to choose a card from 0 to N-1
(where N is the number of cards in the victim's hand). The victim gets a
message saying "<player> stole a card from you" and to all other players saying
"<player> stole a card from <victim>".  The card in the victim's hand at the
chosen position flashes 3 times and then is moved to the current player's hand.

Playing a SKIP card immediately ends the current player's turn immediately
without drawing a card.  If a SKIP card is used after an ATTACK has been
played, it only clears 1 of the ATTACK card's attacks.  Playing 2 SKIP cards
would defend against an ATTACK. A mesage is sent to all players saying <player>
skipped".

Playing an ATTACK card ends the current player's turn immediately without drawing
a card, and forces the next player to take 2 turns in a row.  A mesge is sent
to all players that "<player> attacked <victim> for <N> turns".  If the victim
of an ATTACK plays another ATTACK card on any of their turns, the attacks
"stack up" and their turns are transferred to the next victim, who must take
the attacker's current and untaken turn(s) PLUS 2 more.  For example, if the
victim of an ATTACK immediately plays another ATTACK, the next player must take
4 turns.  If the victim of an ATTACK took one turn and then played ATTACK, the
next player must take 3 turns.  The victim of an attack should see a counter of
turns remaining in the timer area.

When a player draws an UPGRADE CLUSTER card, they must reinsert it into the
deck, the same as an EXPLODING CLUSTER card, except it goes in face-up.  They
do not need to play a DEBUG card.  When a player is forced to draw the face-up
UPGRADE CLUSTER card, they are immediately out of the game.  This card can not
be stopped with a DEBUG or NAK.  If the deck is shuffled, this card must remain
face up.
