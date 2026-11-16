import { getMyKycStatus, kycMissing, submitKyc, type KycSubmission } from "../api";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue("token") }));

const complete: KycSubmission = {
  legal_full_name: "Awa Ngono", date_of_birth: "1994-05-21", national_id_number: "CM123456", residential_address: "Bastos, Yaounde",
  id_document_front_image_url: "https://cdn/front.jpg", id_document_back_image_url: "https://cdn/back.jpg", selfie_image_url: "https://cdn/selfie.jpg",
};

describe("identity verification", () => {
  it("lists what's still missing, including a real date of birth", () => {
    expect(kycMissing(complete)).toEqual([]);
    expect(kycMissing({ ...complete, date_of_birth: "21/05/1994" })).toEqual(["date_of_birth"]);
    expect(kycMissing({ ...complete, date_of_birth: "1994-13-45" })).toEqual(["date_of_birth"]);
    expect(kycMissing({ ...complete, legal_full_name: "  ", selfie_image_url: "" })).toEqual(["legal_full_name", "selfie_image_url"]);
  });

  it("treats 'nothing submitted' as null, and shows the server's field error on submit", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({ ...complete, kyc_status: "PENDING" }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ date_of_birth: ["You must be at least 18."] }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await getMyKycStatus()).toBeNull();
    expect((await submitKyc(complete)).kyc_status).toBe("PENDING");
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/auth\/kyc\/$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(complete);
    await expect(submitKyc(complete)).rejects.toThrow("You must be at least 18.");
  });
});
