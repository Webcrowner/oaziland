import { translate } from "..";
import { en, fr, type MessageKey } from "../messages";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));

describe("translations", () => {
  it("fills in placeholders, in either language", () => {
    expect(translate("en", "oazigo.youCancelled", { reason: "Plans changed" })).toBe("You cancelled: Plans changed");
    expect(translate("fr", "oazigo.youCancelled", { reason: "Changement de programme" })).toBe("Vous avez annulé : Changement de programme");
    expect(translate("en", "kyc.progress", { done: 3, total: 7 })).toBe("3 of 7 done");
    // An unknown placeholder is left visible rather than silently dropped.
    expect(translate("en", "kyc.progress", { done: 3 })).toBe("3 of {total} done");
  });

  it("has a French text for every English key, using the same placeholders", () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(fr[key]?.trim()).toBeTruthy();
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect({ key, fr: placeholders(fr[key]) }).toEqual({ key, fr: placeholders(en[key]) });
    }
  });
});
