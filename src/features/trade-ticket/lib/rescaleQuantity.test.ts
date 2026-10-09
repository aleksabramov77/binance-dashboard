import { describe, expect, it } from "vitest";
import { rescaleQuantity } from "./rescaleQuantity";

describe("rescaleQuantity", () => {
  it("сохраняет риск в долларах при более широком стопе", () => {
    // было: 2 × (100 − 95) = $10 риска; стало: стоп 10$ на единицу → 1 единица
    expect(
      rescaleQuantity(
        2,
        { entry: 100, stopLoss: 95 },
        { entry: 100, stopLoss: 90 },
      ),
    ).toBeCloseTo(1);
  });

  it("не увеличивает объём позиции сверх исходного при более узком стопе", () => {
    // риск позволил бы 10 единиц, но объём был $200 → не больше 2 единиц
    expect(
      rescaleQuantity(
        2,
        { entry: 100, stopLoss: 95 },
        { entry: 100, stopLoss: 99 },
      ),
    ).toBeCloseTo(2);
  });

  it("учитывает новую цену входа", () => {
    expect(
      rescaleQuantity(
        2,
        { entry: 100, stopLoss: 95 },
        { entry: 200, stopLoss: 190 },
      ),
    ).toBeCloseTo(1);
  });
});
