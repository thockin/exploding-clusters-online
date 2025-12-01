import { Card, CardClass } from '../../api';
export type { Card };

const cardDefinitions = [
  {
    class: CardClass.ExplodingCluster,
    title: 'Shattered, like my dreams',
    idname: 'broken_logo',
    image: 'exploding_-_broken_logo.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.ExplodingCluster,
    title: 'I used to bullseye womp rats in my T-16',
    idname: 'deathstar',
    image: 'exploding_-_deathstar.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.ExplodingCluster,
    title: 'The ghost in the machine has escaped',
    idname: 'ghost',
    image: 'exploding_-_ghost.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.ExplodingCluster,
    title: 'I gave them an upgrade they couldn\'t refuse',
    idname: 'phippy',
    image: 'exploding_-_phippy.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.UpgradeCluster,
    title: 'Early-adopter tax',
    idname: 'logos1',
    image: 'upgrade_-_logos1.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.UpgradeCluster,
    title: 'Skip-version upgrade',
    idname: 'logos2',
    image: 'upgrade_-_logos2.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Attack,
    title: 'Paint that bikeshed',
    idname: 'bikeshed',
    image: 'attack_-_bikeshed.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Attack,
    title: 'kubectl --force',
    idname: 'dash_dash_force',
    image: 'attack_-_dash_dash_force.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Attack,
    title: 'Push on Friday',
    idname: 'push_on_friday',
    image: 'attack_-_push_on_friday.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Attack,
    title: 'Use :latest in prod',
    idname: 'use_latest',
    image: 'attack_-_use_latest.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Debug,
    title: 'SRE to the ER, stat!',
    idname: 'cpr',
    image: 'debug_-_cpr.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Debug,
    title: 'It\'s elementary',
    idname: 'elementary',
    image: 'debug_-_elementary.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Debug,
    title: 'git bisect',
    idname: 'git_bisect',
    image: 'debug_-_git_bisect.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Debug,
    title: 'Roll it back',
    idname: 'roll_it_back',
    image: 'debug_-_roll_it_back.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Debug,
    title: 'Silence the alert',
    idname: 'silence',
    image: 'debug_-_silence.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Debug,
    title: 'Swarm on it',
    idname: 'swarm',
    image: 'debug_-_swarm.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Favor,
    title: 'Code review',
    idname: 'code_review',
    image: 'favor_-_code_review.png',
    now: false,
    combo: false,
    count: 2
  },
  {
    class: CardClass.Favor,
    title: 'Cut, paste',
    idname: 'cut_paste',
    image: 'favor_-_cut_paste.png',
    now: false,
    combo: false,
    count: 2
  },
  
  {
    class: CardClass.Nak,
    title: 'Put it on the backlog',
    idname: 'backlog',
    image: 'nak_-_backlog.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Nak,
    title: 'Kelsey Hightower',
    idname: 'kelsey',
    image: 'nak_-_kelsey.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Nak,
    title: 'Feature delayed',
    idname: 'next_release',
    image: 'nak_-_next_release.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Nak,
    title: 'Scratch your own itch',
    idname: 'prs_welcome',
    image: 'nak_-_prs_welcome.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Nak,
    title: 'Bot cmd FTW',
    idname: 'slash_close',
    image: 'nak_-_slash_close.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.SeeTheFuture,
    title: 'Check the dashboard',
    idname: 'dashboard',
    image: 'see_future_-_dashboard.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.SeeTheFuture,
    title: 'Date-driven launch',
    idname: 'date_driven',
    image: 'see_future_-_date_driven.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.SeeTheFuture,
    title: 'Invoke --dry-run',
    idname: 'dry_run',
    image: 'see_future_-_dry_run.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.SeeTheFuture,
    title: 'Learn from the past',
    idname: 'learn_from_the_past',
    image: 'see_future_-_learn_from_past.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.SeeTheFuture,
    title: 'Read RELEASE_NOTES',
    idname: 'release_notes',
    image: 'see_future_-_release_notes.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Shuffle,
    title: 'Double trouble',
    idname: 'double_trouble',
    image: 'shuffle_-_double_trouble.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Shuffle,
    title: 'Node failure',
    idname: 'node_failure',
    image: 'shuffle_-_node_failure.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Shuffle,
    title: 'Rolling update',
    idname: 'rolling_update',
    image: 'shuffle_-_rolling_update.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.ShuffleNow,
    title: 'It\'s consistent, eventually',
    idname: 'eventually_consistent',
    image: 'shuffle_now_-_eventually_consistent.png',
    now: true,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Skip,
    title: 'Punt to oncall',
    idname: 'oncall',
    image: 'skip_-_oncall.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Skip,
    title: 'Work-life balance',
    idname: 'ooo',
    image: 'skip_-_ooo.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Skip,
    title: 'Accrue tech-debt',
    idname: 'tech_debt',
    image: 'skip_-_tech_debt.png',
    now: false,
    combo: false,
    count: 1
  },
  {
    class: CardClass.Skip,
    title: 'Unplanned day off',
    idname: 'unicorn',
    image: 'skip_-_unicorn.png',
    now: false,
    combo: false,
    count: 1
  },
  
  {
    class: CardClass.Developer,
    title: 'Bash firefighter',
    idname: 'firefighter',
    image: 'developer_-_firefighter.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Grumpy greybeard',
    idname: 'grumpy_greybeard',
    image: 'developer_-_grumpy_greybeard.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Helpful helper',
    idname: 'helper',
    image: 'developer_-_helper.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Baby-faced intern',
    idname: 'intern',
    image: 'developer_-_intern.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Mister Logical',
    idname: 'logical',
    image: 'developer_-_logical.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Nit picker',
    idname: 'nit_picker',
    image: 'developer_-_nit_picker.png',
    now: false,
    combo: true,
    count: 4
  },
  {
    class: CardClass.Developer,
    title: 'Kubernetes Prow Robot',
    idname: 'prow_robot',
    image: 'developer_-_prow_robot.png',
    now: false,
    combo: true,
    count: 4
  },
];

const generateDeck = (): Card[] => {
  const deck: Card[] = [];

  const createCard = (def: typeof cardDefinitions[0], ordinal: number) => ({
    // Unique ID is tuple of {class}, {idname}, {ordinal}.
    id: `${def.class}-${def.idname}-${ordinal}`,
    // We could also add a semantic ID field if needed
    class: def.class,
    name: def.title,
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
