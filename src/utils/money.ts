import type { Money } from "../domain/types.js";

export const eur = (amountMinor: number): Money => ({ amountMinor, currency: "EUR" });
export const addMoney = (a: Money, b: Money): Money => ({ amountMinor: a.amountMinor + b.amountMinor, currency: a.currency });
export const subtractMoney = (a: Money, b: Money): Money => ({ amountMinor: a.amountMinor - b.amountMinor, currency: a.currency });
export const multiplyMoney = (a: Money, factor: number): Money => ({ amountMinor: Math.round(a.amountMinor * factor), currency: a.currency });
export const euroText = (money: Money): string => `${(money.amountMinor / 100).toFixed(2).replace(".", ",")} €`;
