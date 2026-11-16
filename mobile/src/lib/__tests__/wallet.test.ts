import { getMyWallet, withdrawWallet, withdrawalBlocker } from "../api";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue("token") }));

describe("wallet payouts", () => {
  it("explains what blocks a withdrawal", () => {
    const verified = { balance_xaf: "5000", kyc_status: "VERIFIED" };
    expect(withdrawalBlocker(verified, 2000)).toBeNull();
    expect(withdrawalBlocker(verified, 6000)).toBe("overBalance");
    expect(withdrawalBlocker(verified, 0)).toBe("noAmount");
    expect(withdrawalBlocker({ ...verified, kyc_status: "PENDING" }, 2000)).toBe("kycPending");
    expect(withdrawalBlocker({ ...verified, kyc_status: "REJECTED" }, 2000)).toBe("kycRejected");
    expect(withdrawalBlocker({ ...verified, kyc_status: "NONE" }, 2000)).toBe("kycMissing");
  });

  it("loads the wallet and sends a payout request", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_xaf: "5000", kyc_status: "VERIFIED", transactions: [], withdrawals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ detail: "Request received." }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ detail: "Insufficient balance." }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await getMyWallet()).balance_xaf).toBe("5000");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
    await withdrawWallet({ amount_xaf: 2000, phone_number: "+237690000000", provider: "ORANGE_MONEY" });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/wallet\/withdraw\/$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ amount_xaf: 2000, phone_number: "+237690000000", provider: "ORANGE_MONEY" });
    await expect(withdrawWallet({ amount_xaf: 99999, phone_number: "+237690000000", provider: "MTN_MOMO" })).rejects.toThrow("Insufficient balance.");
  });
});
