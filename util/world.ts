import { kSecondaryPort } from '@/config';

interface PlayerWithDimension {
  currentServerPort: number;
  currentDimension: string;
}

export function getWorldForPlayer(player: PlayerWithDimension): string {
  const base = player.currentServerPort === kSecondaryPort ? 'last' : 'world';
  const dim = player.currentDimension;
  if (dim === 'nether' || dim === 'minecraft:the_nether' || dim.endsWith(':the_nether')) {
    return `${base}_nether`;
  }
  if (dim === 'end' || dim === 'minecraft:the_end' || dim.endsWith(':the_end')) {
    return `${base}_the_end`;
  }
  return base;
}
