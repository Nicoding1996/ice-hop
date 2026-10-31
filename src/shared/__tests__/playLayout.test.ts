import { describe, expect, it } from 'vitest';
import { ACTION_BAR_GAP, ACTION_BAR_HEIGHT, actionBarSlots, playLayout } from '../playLayout';

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [320, 568],
  [360, 640],
  [390, 844],
  [430, 932],
  [700, 520],
  [1000, 800],
];

describe('playLayout', () => {
  it.each(SIZES)('keeps the HUD, board, action bar and tip on a %ix%i screen', (width, height) => {
    const layout = playLayout({ width, height, cols: 5, rows: 5 });
    const gridBottom = layout.originY + layout.cell * 5;
    expect(layout.cell).toBeGreaterThanOrEqual(24);
    expect(layout.originX).toBeGreaterThanOrEqual(16);
    expect(layout.originX + layout.cell * 5).toBeLessThanOrEqual(width - 16);
    expect(layout.originY).toBeGreaterThan(layout.hudBottom);
    expect(layout.actionsY - ACTION_BAR_HEIGHT / 2).toBeGreaterThan(gridBottom);
    expect(layout.tipY).toBeGreaterThan(layout.actionsY + ACTION_BAR_HEIGHT / 2);
    expect(layout.tipY).toBeLessThan(height);
  });

  it('grows the board on a taller screen and fits wide Practice lessons', () => {
    const phone = playLayout({ width: 390, height: 640, cols: 5, rows: 5 });
    const tall = playLayout({ width: 390, height: 844, cols: 5, rows: 5 });
    expect(tall.cell).toBeGreaterThanOrEqual(phone.cell);
    const lesson = playLayout({ width: 390, height: 844, cols: 5, rows: 3 });
    expect(lesson.originX + lesson.cell * 5).toBeLessThanOrEqual(390 - 16);
  });
});

describe('actionBarSlots', () => {
  it('centres equal slots that never overlap or exceed the bar', () => {
    for (const count of [2, 3]) {
      const { slotWidth, centers } = actionBarSlots(360, count, 328);
      expect(centers).toHaveLength(count);
      expect(slotWidth).toBeLessThanOrEqual(112);
      const left = (centers[0] ?? 0) - slotWidth / 2;
      const right = (centers[count - 1] ?? 0) + slotWidth / 2;
      expect(left + right).toBeCloseTo(360);
      expect(right - left).toBeLessThanOrEqual(328);
      for (let index = 1; index < count; index++) {
        expect((centers[index] ?? 0) - (centers[index - 1] ?? 0)).toBeCloseTo(slotWidth + ACTION_BAR_GAP);
      }
    }
  });

  it('shrinks slots to fit a narrow bar', () => {
    const { slotWidth } = actionBarSlots(320, 3, 200);
    expect(slotWidth * 3 + ACTION_BAR_GAP * 2).toBeCloseTo(200);
  });
});
