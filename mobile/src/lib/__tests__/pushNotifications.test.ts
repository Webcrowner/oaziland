import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { registerDeviceForPush, unregisterDeviceForPush } from "../pushNotifications";

jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mocked = Notifications as unknown as Record<string, jest.Mock>;
const TOKEN = "ExponentPushToken[abc]";

describe("push device registration", () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  beforeEach(async () => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await SecureStore.setItemAsync("access_token", "jwt");
    mocked.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocked.getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
  });

  it("registers the phone's Expo token, then removes it on sign-out", async () => {
    expect(await registerDeviceForPush()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/push\/devices\/$/);
    expect(JSON.parse(init.body)).toEqual({ platform: "EXPO", token: TOKEN });
    expect(init.headers.Authorization).toBe("Bearer jwt");

    await unregisterDeviceForPush();
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/push\/devices\/remove\/$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: TOKEN });
  });

  it("does nothing when permission is refused or push isn't connected yet", async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    mocked.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
    expect(await registerDeviceForPush()).toBe(false);

    mocked.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocked.getExpoPushTokenAsync.mockRejectedValue(new Error("No projectId"));
    expect(await registerDeviceForPush()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
