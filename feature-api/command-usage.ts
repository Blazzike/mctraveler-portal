import { getRegisteredCommands } from '@/feature-api/command';
import paint, { NamedTextColor, Paint, TextDecoration } from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

export function checkIncompleteCommand(commandStr: string, _sender: OnlinePlayer): Paint | null {
  const parts = commandStr.split(' ');
  const commandName = parts[0];

  if (!commandName) return null;

  let foundPattern = false;
  const commands = getRegisteredCommands();
  for (const cmd of commands) {
    const result = cmd.pattern.match(commandStr);

    if (result.matches) {
      return null;
    }

    const patternStr = cmd.pattern.toString();
    const patternParts = patternStr.split(' ');
    const firstPattern = patternParts[0];

    let commandMatches = firstPattern === commandName;
    if (!commandMatches && firstPattern && firstPattern.includes('|')) {
      const optionsMatch = firstPattern.match(/<[^:]+:([^>]+)>/);
      if (optionsMatch?.[1]) {
        const options = optionsMatch[1].split('|');
        commandMatches = options.includes(commandName);
      }
    }

    if (commandMatches) {
      foundPattern = true;

      const specificError = analyzeFailure(patternStr, parts, result.error);
      if (specificError) {
        return specificError;
      }
    }
  }

  if (foundPattern) {
    const commandPatterns = getRegisteredCommands();
    for (const cmd of commandPatterns) {
      const patternStr = cmd.pattern.toString();
      const patternParts = patternStr.split(' ');
      const firstPattern = patternParts[0];

      let isMatch = firstPattern === commandName;
      if (!isMatch && firstPattern && firstPattern.includes('|')) {
        const optionsMatch = firstPattern.match(/<[^:]+:([^>]+)>/);
        if (optionsMatch?.[1]) {
          const options = optionsMatch[1].split('|');
          isMatch = options.includes(commandName);
        }
      }

      if (isMatch) {
        return generateUsageMessage(patternStr, parts.length - 1, commandName);
      }
    }
  }

  return null;
}

function generateUsageMessage(patternStr: string, providedArgs: number, actualCommand: string): Paint {
  const parts = patternStr.split(' ');
  const _firstPart = parts[0];

  const usageParts = parts.map((part, index) => {
    if (index === 0) {
      return `/${actualCommand}`;
    }

    if (index <= providedArgs) {
      return part;
    } else {
      return part;
    }
  });

  return paint.error`Usage: ${usageParts.join(' ')}`;
}

function analyzeFailure(patternStr: string, parts: string[], parserError?: Paint): Paint | null {
  if (parserError) {
    return new Paint(undefined, undefined, [new Paint(NamedTextColor.red, [TextDecoration.bold], ['ERROR']), ' ', parserError]);
  }

  const commandName = parts[0] || '';
  return generateUsageMessage(patternStr, 0, commandName);
}
