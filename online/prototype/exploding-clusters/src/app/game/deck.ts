export interface Card {
  id: string;
  name: string;
  cardClass: string;
  imageUrl: string;
}

const cardClasses = {
  EXPLODING_CLUSTER: 'Exploding Cluster',
  UPGRADE_CLUSTER: 'Upgrade Cluster',
  ATTACK: 'Attack 2x',
  DEBUG: 'Debug',
  FAVOR: 'Favor',
  NAK: 'Nak',
  SEE_THE_FUTURE: 'See the Future',
  SHUFFLE: 'Shuffle',
  SHUFFLE_NOW: 'Shuffle Now',
  SKIP: 'Skip',
  DEVELOPER: 'Developer',
};

// Filenames from the public/art directory
const artFiles = [
  'attack_-_bikeshed.png', 'attack_-_dash_dash_force.png', 'attack_-_push_on_friday.png', 'attack_-_use_latest.png',
  'debug_-_cpr.png', 'debug_-_elementary.png', 'debug_-_git_bisect.png', 'debug_-_roll_it_back.png', 'debug_-_silence.png', 'debug_-_swarm.png',
  'developer_-_firefighter.png', 'developer_-_grumpy_greybeard.png', 'developer_-_helper.png', 'developer_-_intern.png', 'developer_-_logical.png', 'developer_-_nit_picker.png', 'developer_-_prow_robot.png',
  'exploding_-_broken_logo.png', 'exploding_-_deathstar.png', 'exploding_-_ghost.png', 'exploding_-_phippy.png',
  'favor_-_code_review.png', 'favor_-_cut_paste.png',
  'nak_-_backlog.png', 'nak_-_kelsey.png', 'nak_-_next_release.png', 'nak_-_prs_welcome.png', 'nak_-_slash_close.png',
  'see_future_-_dashboard.png', 'see_future_-_date_driven.png', 'see_future_-_dry_run.png', 'see_future_-_learn_from_past.png', 'see_future_-_release_notes.png',
  'shuffle_-_double_trouble.png', 'shuffle_-_node_failure.png', 'shuffle_-_rolling_update.png',
  'shuffle_now_-_eventually_consistent.png',
  'skip_-_oncall.png', 'skip_-_ooo.png', 'skip_-_tech_debt.png', 'skip_-_unicorn.png',
  'upgrade_-_logos1.png', 'upgrade_-_logos2.png',
];

const generateDeck = (): Card[] => {
  const deck: Card[] = [];
  let id = 0;

  const createCard = (cardClass: string, name: string, imageUrl: string) => ({
    id: `card-${id++}`,
    cardClass: cardClass,
    name,
    imageUrl: `/art/${imageUrl}`,
  });

  const getName = (filename: string) => filename.replace(/.*?_-_(.*?)\.png/, '$1').replace(/_/g, ' ');

  const favorFiles = artFiles.filter(f => f.startsWith('favor_-_'));
  const developerFiles = artFiles.filter(f => f.startsWith('developer_-_'));

  artFiles.forEach(file => {
    if (file.startsWith('exploding_-_')) deck.push(createCard(cardClasses.EXPLODING_CLUSTER, getName(file), file));
    else if (file.startsWith('upgrade_-_')) deck.push(createCard(cardClasses.UPGRADE_CLUSTER, getName(file), file));
    else if (file.startsWith('attack_-_')) deck.push(createCard(cardClasses.ATTACK, getName(file), file));
    else if (file.startsWith('debug_-_')) deck.push(createCard(cardClasses.DEBUG, getName(file), file));
    else if (file.startsWith('nak_-_')) deck.push(createCard(cardClasses.NAK, getName(file), file));
    else if (file.startsWith('see_future_-_')) deck.push(createCard(cardClasses.SEE_THE_FUTURE, getName(file), file));
    else if (file.startsWith('shuffle_-_')) deck.push(createCard(cardClasses.SHUFFLE, getName(file), file));
    else if (file.startsWith('shuffle_now_-_')) deck.push(createCard(cardClasses.SHUFFLE_NOW, getName(file), file));
    else if (file.startsWith('skip_-_')) deck.push(createCard(cardClasses.SKIP, getName(file), file));
  });

  // 4 "favor" cards (2 copies each of 2 files)
  favorFiles.forEach(file => {
    deck.push(createCard(cardClasses.FAVOR, getName(file), file));
    deck.push(createCard(cardClasses.FAVOR, getName(file), file));
  });

  // 28 "developer" cards (7 sets of 4)
  developerFiles.forEach(file => {
    for (let i = 0; i < 4; i++) {
      deck.push(createCard(cardClasses.DEVELOPER, getName(file), file));
    }
  });

  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const fullDeck = generateDeck();
