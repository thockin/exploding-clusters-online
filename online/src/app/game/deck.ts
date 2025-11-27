export interface Card {
  id: string;
  name: string;
  cardClass: string;
  imageUrl: string;
  now?: boolean;
  combo?: boolean;
}

const cardDefinitions = [
  { class: 'EXPLODING_CLUSTER', name: 'broken logo', image: 'exploding_-_broken_logo.png', now: false, combo: false, count: 1 },
  { class: 'EXPLODING_CLUSTER', name: 'deathstar', image: 'exploding_-_deathstar.png', now: false, combo: false, count: 1 },
  { class: 'EXPLODING_CLUSTER', name: 'ghost', image: 'exploding_-_ghost.png', now: false, combo: false, count: 1 },
  { class: 'EXPLODING_CLUSTER', name: 'phippy', image: 'exploding_-_phippy.png', now: false, combo: false, count: 1 },
  
  { class: 'UPGRADE_CLUSTER', name: 'logos1', image: 'upgrade_-_logos1.png', now: false, combo: false, count: 1 },
  { class: 'UPGRADE_CLUSTER', name: 'logos2', image: 'upgrade_-_logos2.png', now: false, combo: false, count: 1 },
  
  { class: 'ATTACK', name: 'bikeshed', image: 'attack_-_bikeshed.png', now: false, combo: false, count: 1 },
  { class: 'ATTACK', name: 'dash dash force', image: 'attack_-_dash_dash_force.png', now: false, combo: false, count: 1 },
  { class: 'ATTACK', name: 'push on friday', image: 'attack_-_push_on_friday.png', now: false, combo: false, count: 1 },
  { class: 'ATTACK', name: 'use latest', image: 'attack_-_use_latest.png', now: false, combo: false, count: 1 },
  
  { class: 'DEBUG', name: 'cpr', image: 'debug_-_cpr.png', now: false, combo: false, count: 1 },
  { class: 'DEBUG', name: 'elementary', image: 'debug_-_elementary.png', now: false, combo: false, count: 1 },
  { class: 'DEBUG', name: 'git bisect', image: 'debug_-_git_bisect.png', now: false, combo: false, count: 1 },
  { class: 'DEBUG', name: 'roll it back', image: 'debug_-_roll_it_back.png', now: false, combo: false, count: 1 },
  { class: 'DEBUG', name: 'silence', image: 'debug_-_silence.png', now: false, combo: false, count: 1 },
  { class: 'DEBUG', name: 'swarm', image: 'debug_-_swarm.png', now: false, combo: false, count: 1 },
  
  { class: 'FAVOR', name: 'code review', image: 'favor_-_code_review.png', now: false, combo: false, count: 2 },
  { class: 'FAVOR', name: 'cut paste', image: 'favor_-_cut_paste.png', now: false, combo: false, count: 2 },
  
  { class: 'NAK', name: 'backlog', image: 'nak_-_backlog.png', now: true, combo: false, count: 1 },
  { class: 'NAK', name: 'kelsey', image: 'nak_-_kelsey.png', now: true, combo: false, count: 1 },
  { class: 'NAK', name: 'next release', image: 'nak_-_next_release.png', now: true, combo: false, count: 1 },
  { class: 'NAK', name: 'prs welcome', image: 'nak_-_prs_welcome.png', now: true, combo: false, count: 1 },
  { class: 'NAK', name: 'slash close', image: 'nak_-_slash_close.png', now: true, combo: false, count: 1 },
  
  { class: 'SEE_THE_FUTURE', name: 'dashboard', image: 'see_future_-_dashboard.png', now: false, combo: false, count: 1 },
  { class: 'SEE_THE_FUTURE', name: 'date driven', image: 'see_future_-_date_driven.png', now: false, combo: false, count: 1 },
  { class: 'SEE_THE_FUTURE', name: 'dry run', image: 'see_future_-_dry_run.png', now: false, combo: false, count: 1 },
  { class: 'SEE_THE_FUTURE', name: 'learn from past', image: 'see_future_-_learn_from_past.png', now: false, combo: false, count: 1 },
  { class: 'SEE_THE_FUTURE', name: 'release notes', image: 'see_future_-_release_notes.png', now: false, combo: false, count: 1 },
  
  { class: 'SHUFFLE', name: 'double trouble', image: 'shuffle_-_double_trouble.png', now: false, combo: false, count: 1 },
  { class: 'SHUFFLE', name: 'node failure', image: 'shuffle_-_node_failure.png', now: false, combo: false, count: 1 },
  { class: 'SHUFFLE', name: 'rolling update', image: 'shuffle_-_rolling_update.png', now: false, combo: false, count: 1 },
  
  { class: 'SHUFFLE_NOW', name: 'eventually consistent', image: 'shuffle_now_-_eventually_consistent.png', now: true, combo: false, count: 1 },
  
  { class: 'SKIP', name: 'oncall', image: 'skip_-_oncall.png', now: false, combo: false, count: 1 },
  { class: 'SKIP', name: 'ooo', image: 'skip_-_ooo.png', now: false, combo: false, count: 1 },
  { class: 'SKIP', name: 'tech debt', image: 'skip_-_tech_debt.png', now: false, combo: false, count: 1 },
  { class: 'SKIP', name: 'unicorn', image: 'skip_-_unicorn.png', now: false, combo: false, count: 1 },
  
  { class: 'DEVELOPER', name: 'firefighter', image: 'developer_-_firefighter.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'grumpy greybeard', image: 'developer_-_grumpy_greybeard.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'helper', image: 'developer_-_helper.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'intern', image: 'developer_-_intern.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'logical', image: 'developer_-_logical.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'nit picker', image: 'developer_-_nit_picker.png', now: false, combo: true, count: 4 },
  { class: 'DEVELOPER', name: 'prow robot', image: 'developer_-_prow_robot.png', now: false, combo: true, count: 4 },
];

const generateDeck = (): Card[] => {
  const deck: Card[] = [];

  const createCard = (def: typeof cardDefinitions[0], ordinal: number) => ({
    // Unique ID is tuple of {class}, {name}, {ordinal}.
    id: `${def.class}-${def.name.replace(/\s+/g, '_')}-${ordinal}`,
    // We could also add a semantic ID field if needed
    cardClass: def.class,
    name: def.name,
    imageUrl: `/art/${def.image}`,
    now: def.now,
    combo: def.combo
  });

  for (const def of cardDefinitions) {
    for (let i = 0; i < def.count; i++) {
        deck.push(createCard(def, i));
    }
  }

  return deck;
};

export const shuffleDeck = <T>(deck: T[], randomFunc: () => number = () => Math.random()): T[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFunc() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const fullDeck = generateDeck();
