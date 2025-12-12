import type { Paint } from '@/feature-api/paint';
import p from '@/feature-api/paint';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';

function getPlayerByUsername(username: string) {
  return OnlinePlayersModule.api.getPlayerByUsername(username);
}

interface ParseResult<T> {
  value: T;
  consumed: number;
  error?: Paint;
}

interface SyntaxParser<T = any, Name extends string = string> {
  readonly name: Name;
  readonly type: string;
  readonly __phantomType?: T;
  match(input: string, position: number): ParseResult<T> | null;
  toString(): string;
}

type TupleToArgsObject<T extends readonly SyntaxParser[]> = {
  [P in T[number] as P extends SyntaxParser<any, infer N> ? N : never]: P extends SyntaxParser<infer R, any> ? R : never;
};

class CommandPattern<T extends readonly SyntaxParser[]> {
  public parts: (string | SyntaxParser)[] = [];

  constructor(
    template: TemplateStringsArray,
    public readonly parsers: T
  ) {
    for (const [i, part] of template.entries()) {
      if (part.trim()) {
        for (const word of part.trim().split(/\s+/)) {
          if (word) this.parts.push(word);
        }
      }
      if (i < parsers.length) {
        const parser = parsers[i];
        if (!parser) {
          throw new Error(`Parser at index ${i} is undefined`);
        }
        this.parts.push(parser);
      }
    }
  }

  match(input: string): {
    matches: boolean;
    args: TupleToArgsObject<T>;
    error?: Paint;
  } {
    const args: Record<string, any> = {};
    const inputWords = input.split(' ');
    let wordIndex = 0;

    for (const part of this.parts) {
      if (typeof part === 'string') {
        const expected = part.trim();
        if (!expected) continue;

        if (wordIndex >= inputWords.length || inputWords[wordIndex] !== expected) {
          return { matches: false, args: {} as TupleToArgsObject<T> };
        }
        wordIndex++;
      } else {
        const remainingInput = inputWords.slice(wordIndex).join(' ');
        const result = part.match(remainingInput, 0);

        if (!result) {
          return { matches: false, args: {} as TupleToArgsObject<T> };
        }

        if (result.error) {
          return {
            matches: false,
            args: {} as TupleToArgsObject<T>,
            error: result.error,
          };
        }

        args[part.name] = result.value;
        wordIndex += result.consumed;
      }
    }

    if (wordIndex < inputWords.length) {
      const lastPart = this.parts[this.parts.length - 1];
      const isRestParser = lastPart && typeof lastPart !== 'string' && lastPart.toString && lastPart.toString().includes('...');
      if (!isRestParser) {
        return { matches: false, args: {} as TupleToArgsObject<T> };
      }
    }

    return { matches: true, args: args as TupleToArgsObject<T> };
  }

  toString(): string {
    return this.parts.map((p) => p.toString()).join(' ');
  }
}

type CommandHandler<T extends readonly SyntaxParser[]> = (context: { sender: OnlinePlayer; args: TupleToArgsObject<T> }) => any;

interface RegisteredCommand {
  pattern: CommandPattern<any>;
  handler: (context: { sender: OnlinePlayer; args: any }) => any;
  featureName?: string;
}

const commands: RegisteredCommand[] = [];

// Track current feature for HMR support
let currentFeatureName: string | null = null;

export function setCurrentFeature(name: string | null): void {
  currentFeatureName = name;
}

export function registerCommand<T extends readonly SyntaxParser[]>(pattern: CommandPattern<T>, handler: CommandHandler<T>): void {
  commands.push({
    pattern,
    handler: handler as (context: { sender: OnlinePlayer; args: any }) => any,
    featureName: currentFeatureName ?? undefined,
  });
}

export function getRegisteredCommands(): RegisteredCommand[] {
  return commands;
}

export function getSuggestionsForCommand(commandText: string, player: any): string[] | null {
  const parts = commandText.split(' ');
  const commandName = parts[0]?.replace('/', '') ?? '';

  for (const cmd of commands) {
    const patternParts = cmd.pattern.parts;

    // Check if command matches
    let matches = false;
    if (typeof patternParts[0] === 'string') {
      matches = patternParts[0] === commandName;
    } else if (patternParts[0]?.type === 'oneof') {
      const opts = (patternParts[0] as any).options || [];
      matches = opts.includes(commandName);
    }

    if (!matches) continue;

    // Find which argument position we're at
    let argIndex = 0;
    for (let i = 1; i < parts.length && argIndex < patternParts.length; i++) {
      const patternPart = patternParts[argIndex + 1];
      if (typeof patternPart === 'string') {
        // Literal - check if it matches
        if (parts[i] === patternPart) {
          argIndex++;
        } else {
          break; // Doesn't match
        }
      } else if (patternPart) {
        // Argument - check if we're at the last part (being typed)
        if (i === parts.length - 1) {
          // This is the argument being typed
          const parser = patternPart as StringParser<any>;
          if (parser.suggestionProvider) {
            const partial = parts[i]?.toLowerCase() ?? '';
            return parser.suggestionProvider(partial, player);
          }
        }
        argIndex++;
      }
    }
  }

  return null;
}

export function clearCommandsForTesting(): void {
  commands.length = 0;
}

export function clearCommandsForFeature(featureName: string): void {
  for (let i = commands.length - 1; i >= 0; i--) {
    if (commands[i]?.featureName === featureName) {
      commands.splice(i, 1);
    }
  }
}

export function getUniqueCommandNames(): string[] {
  const commandNames = new Set<string>();

  for (const cmd of commands) {
    const pattern = cmd.pattern.toString();
    const parts = pattern.split(' ');
    const firstPart = parts[0];

    if (firstPart) {
      if (firstPart.includes('|')) {
        const match = firstPart.match(/<[^:]+:([^>]+)>/);
        if (match?.[1]) {
          const options = match[1].split('|');
          for (const opt of options) {
            commandNames.add(opt);
          }
        }
      } else {
        commandNames.add(firstPart);
      }
    }
  }

  return Array.from(commandNames);
}

export function executeCommand(player: OnlinePlayer | any, commandStr: string): any {
  let lastError: any = null;

  for (const cmd of commands) {
    const result = cmd.pattern.match(commandStr);

    if (result.matches) {
      const context = {
        sender: player,
        args: result.args,
      };

      try {
        console.log(`${player.name}: /${commandStr} (${cmd.pattern})`);
        const commandResult = cmd.handler(context);
        return commandResult === undefined ? true : commandResult;
      } catch (error) {
        console.error(`Error executing command /${commandStr}:`, error);
        return true;
      }
    } else if (result.error) {
      lastError = result.error;
    }
  }

  if (lastError) {
    return lastError;
  }

  console.log(`${player.name}: /${commandStr} (Invalid command)`);
  return false;
}

export type SuggestionProvider = (partial: string, player: any) => string[];

class StringParser<Name extends string = string> implements SyntaxParser<string, Name> {
  constructor(
    public readonly name: Name,
    private readonly restMode: boolean = false,
    public readonly suggestionProvider?: SuggestionProvider
  ) {}

  readonly type = 'string';

  match(input: string, position: number): ParseResult<string> | null {
    const trimmed = input.substring(position).trim();
    if (!trimmed) return null;

    if (this.restMode) {
      return { value: trimmed, consumed: trimmed.split(' ').length };
    } else {
      const words = trimmed.split(' ');
      const firstWord = words[0];
      if (!firstWord) return null;
      return { value: firstWord, consumed: 1 };
    }
  }

  rest<N extends string>(name: N): StringParser<N> {
    return new StringParser(name, true);
  }

  withSuggestions<N extends string>(name: N, provider: SuggestionProvider): StringParser<N> {
    return new StringParser(name, this.restMode, provider);
  }

  toString(): string {
    return `<${this.name}:${this.restMode ? 'string...' : 'string'}>`;
  }
}

class OnlinePlayerParser<Name extends string = string> implements SyntaxParser<OnlinePlayer, Name> {
  constructor(public readonly name: Name) {}

  readonly type = 'player';

  match(input: string, position: number): ParseResult<OnlinePlayer> | null {
    const trimmed = input.substring(position).trim();
    if (!trimmed) {
      return null;
    }

    const words = trimmed.split(' ');
    const username = words[0];
    if (!username) return null;

    const player = getPlayerByUsername(username);
    if (!player) {
      return {
        value: null as any,
        consumed: 1,
        error: p.gray`Player ${p.red(username)} not found or is offline`,
      };
    }

    return { value: player, consumed: 1 };
  }

  toString(): string {
    return `<${this.name}:player>`;
  }
}

class IntegerParser<Name extends string = string> implements SyntaxParser<number, Name> {
  constructor(public readonly name: Name) {}

  readonly type = 'integer';

  match(input: string, position: number): ParseResult<number> | null {
    const trimmed = input.substring(position).trim();
    if (!trimmed) return null;

    const words = trimmed.split(' ');
    const firstWord = words[0];
    if (!firstWord) return null;

    const parsed = parseInt(firstWord, 10);
    if (Number.isNaN(parsed)) {
      return { value: 0, consumed: 0, error: p.error`Expected a number, got '${p.red(firstWord)}'` };
    }

    return { value: parsed, consumed: 1 };
  }

  toString(): string {
    return `<${this.name}:integer>`;
  }
}

class OneOfParser<Name extends string, T extends readonly string[]> implements SyntaxParser<T[number], Name> {
  constructor(
    public readonly name: Name,
    private readonly options: T
  ) {}

  readonly type = 'oneof';

  match(input: string, position: number): ParseResult<T[number]> | null {
    const trimmed = input.substring(position).trim();
    if (!trimmed) return null;

    const words = trimmed.split(' ');
    const firstWord = words[0];
    if (!firstWord) return null;

    const word = firstWord.toLowerCase();

    if (this.options.includes(word as T[number])) {
      return { value: word as T[number], consumed: 1 };
    }

    return null;
  }

  toString(): string {
    return `<${this.name}:${this.options.join('|')}>`;
  }
}

const SyntaxBuilder = {
  call<T extends readonly SyntaxParser[]>(template: TemplateStringsArray, ...parsers: T): CommandPattern<T> {
    return new CommandPattern(template, parsers);
  },

  string: new StringParser('string'),

  onlinePlayer<N extends string>(name: N): OnlinePlayerParser<N> {
    return new OnlinePlayerParser(name);
  },

  oneOf<N extends string, T extends readonly string[]>(name: N, options: T): OneOfParser<N, T> {
    return new OneOfParser(name, options);
  },

  integer<N extends string>(name: N): IntegerParser<N> {
    return new IntegerParser(name);
  },
};

function createSyntaxProxy() {
  const templateFunction = <T extends readonly SyntaxParser[]>(template: TemplateStringsArray, ...parsers: T): CommandPattern<T> => {
    return SyntaxBuilder.call(template, ...parsers);
  };

  Object.setPrototypeOf(templateFunction, SyntaxBuilder);
  for (const name of Object.keys(SyntaxBuilder)) {
    if (name !== 'call') {
      (templateFunction as any)[name] = (SyntaxBuilder as any)[name];
    }
  }

  return templateFunction as typeof SyntaxBuilder & typeof templateFunction;
}

export const syntax = createSyntaxProxy();
