import type { Level } from './Level';
import { Level1 } from './Level1';
import { Level2 } from './Level2';
import { Level3 } from './Level3';
import { Level4 } from './Level4';

/** Level factories, in play order. Add new levels here. */
export const levels: Array<() => Level> = [
  () => new Level1(),
  () => new Level2(),
  () => new Level3(),
  () => new Level4(),
];
