export interface EnvVarDefinition {
  name: string;
  description: string;
  defaultValue: string | number | boolean;
  type: 'string' | 'number' | 'boolean';
}

const envVars: EnvVarDefinition[] = [
  {
    name: 'PORT',
    description: 'The port the server listens on.',
    defaultValue: 3000,
    type: 'number',
  },
  {
    name: 'DEVMODE',
    description: 'If "1", enables development mode features (pre-defined hands, debug buttons, shorter timers).',
    defaultValue: false,
    type: 'boolean',
  },
  {
    name: 'VERBOSE',
    description: 'If "1", enables verbose logging.',
    defaultValue: false,
    type: 'boolean',
  },
  {
    name: 'MAX_GAMES',
    description: 'The maximum number of concurrent games allowed.',
    defaultValue: 128,
    type: 'number',
  },
  {
    name: 'MAX_SPECTATORS',
    description: 'The limit for spectators per game.',
    defaultValue: 10,
    type: 'number',
  },
  {
    name: 'REACTION_TIMER',
    description: 'Number of seconds for the reaction timer.',
    defaultValue: 10,
    type: 'number',
  },
  {
    name: 'GO_FAST',
    description: 'If "1", speeds up all timers and animations to 0.5s.',
    defaultValue: 0,
    type: 'number',
  },
  {
    name: 'NODE_ENV',
    description: 'Node environment (e.g., "production", "development").',
    defaultValue: 'development',
    type: 'string',
  },
];

export const config = {
  get port(): number {
    return parseInt(process.env.PORT || '3000', 10);
  },
  get devMode(): boolean {
    return process.env.DEVMODE === '1';
  },
  get verbose(): boolean {
    return process.env.VERBOSE === '1';
  },
  get maxGames(): number {
    const val = process.env.MAX_GAMES;
    if (val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed >= 1) return parsed;
      console.warn(`Invalid MAX_GAMES value "${val}", using default of 128`);
    }
    return 128;
  },
  get maxSpectators(): number {
    const val = process.env.MAX_SPECTATORS;
    if (val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) return parsed;
      console.warn(`Invalid MAX_SPECTATORS value "${val}", using default of 10`);
    }
    return 10;
  },
  get reactionTimer(): number {
    const val = process.env.REACTION_TIMER;
    if (val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) return parsed;
      console.warn(`Invalid REACTION_TIMER value "${val}", using default of 10`);
    }
    return 10;
  },
  get goFast(): boolean {
    return process.env.GO_FAST === '1';
  },
  get nodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  },
  get isDev(): boolean {
    return this.nodeEnv !== 'production';
  }
};

export function printHelp() {
  console.log('Exploding Clusters Server - Environment Variables\n');
  console.log('Usage: [ENV_VAR=value] npm start [options]\n');
  console.log('Options:');
  console.log('  --help    Show this help message and exit\n');
  console.log('Environment Variables:');
  
  for (const env of envVars) {
    let defaultStr = String(env.defaultValue);
    if (env.type === 'boolean') defaultStr = env.defaultValue ? '"1"' : '"0" (or unset)';
    
    console.log(`  ${env.name.padEnd(20)} ${env.description}`);
    console.log(`  ${''.padEnd(20)} Default: ${defaultStr}`);
    console.log('');
  }
}
