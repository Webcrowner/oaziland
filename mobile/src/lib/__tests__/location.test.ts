import * as Location from "expo-location";
import { getCurrentCoords } from "../location";

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const mocked = Location as unknown as {
  requestForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
  getLastKnownPositionAsync: jest.Mock;
};

const fix = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } });

describe("getCurrentCoords", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns the current position when permission is granted", async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocked.getCurrentPositionAsync.mockResolvedValue(fix(3.848, 11.502));
    await expect(getCurrentCoords()).resolves.toEqual({ latitude: 3.848, longitude: 11.502 });
  });

  it("returns null and never asks for a position when permission is refused", async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    await expect(getCurrentCoords()).resolves.toBeNull();
    expect(mocked.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("falls back to the last known position when the fix is too slow", async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocked.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mocked.getLastKnownPositionAsync.mockResolvedValue(fix(3.9, 11.6));
    await expect(getCurrentCoords(20)).resolves.toEqual({ latitude: 3.9, longitude: 11.6 });
  });

  it("returns null when the slow fix has no fallback, or the library throws", async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocked.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mocked.getLastKnownPositionAsync.mockResolvedValue(null);
    await expect(getCurrentCoords(20)).resolves.toBeNull();

    mocked.requestForegroundPermissionsAsync.mockRejectedValue(new Error("no location services"));
    await expect(getCurrentCoords()).resolves.toBeNull();
  });
});
