import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { searchPlaces, type PlaceSuggestion } from "../lib/api";
import { getCurrentCoords } from "../lib/location";
import { useI18n } from "../i18n";

export type RidePoint = { latitude: number; longitude: number } | null;

const SEARCH_DELAY_MS = 600;

/** A pickup or drop-off: search a place in Cameroon or, for pickup, use the phone's location. Only a chosen place counts. */
export default function RidePlaceField({
  placeholder, text, onTextChange, point, onPointChange, allowCurrentLocation = false,
}: {
  placeholder: string;
  text: string;
  onTextChange: (text: string) => void;
  point: RidePoint;
  onPointChange: (point: RidePoint) => void;
  allowCurrentLocation?: boolean;
}) {
  const { t, language } = useI18n();
  const [typed, setTyped] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = text.trim();
    if (!typed || query.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(query, language, controller.signal).then(setSuggestions).catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, typed, language]);

  function onChange(value: string) {
    onTextChange(value);
    setTyped(true);
    setError("");
    // Typing a new place forgets the old point, so the price always matches what's shown.
    if (point) onPointChange(null);
    if (value.trim().length < 3) setSuggestions([]);
  }

  function pick(place: PlaceSuggestion) {
    setTyped(false);
    setSuggestions([]);
    onTextChange(place.label);
    onPointChange({ latitude: place.latitude, longitude: place.longitude });
  }

  async function useMyLocation() {
    setLocating(true);
    setError("");
    const coords = await getCurrentCoords(10000);
    setLocating(false);
    if (!coords) {
      setError(t("oazigo.gpsDenied"));
      return;
    }
    setTyped(false);
    setSuggestions([]);
    onPointChange({ latitude: Number(coords.latitude.toFixed(6)), longitude: Number(coords.longitude.toFixed(6)) });
    if (!text.trim()) onTextChange(t("oazigo.currentLocation"));
  }

  return (
    <View style={styles.wrap}>
      <TextInput style={[styles.input, point ? styles.inputSet : null]} placeholder={placeholder} value={text} onChangeText={onChange} />
      {typed && suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((place) => (
            <TouchableOpacity key={place.id} style={styles.item} onPress={() => pick(place)}>
              <Text style={styles.itemText}>📍 {place.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        {allowCurrentLocation ? (
          <TouchableOpacity style={styles.chip} onPress={useMyLocation} disabled={locating}>
            {locating ? <ActivityIndicator size="small" color="#1B2A4A" /> : <Text style={styles.chipText}>{t("oazigo.useMyLocation")}</Text>}
          </TouchableOpacity>
        ) : null}
        {point ? <Text style={styles.set}>✓ {t("oazigo.placeSet")}</Text> : null}
        {!point && text.trim().length >= 3 ? <Text style={styles.hint}>{t("oazigo.pickFromList")}</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: "#FFFFFF" },
  inputSet: { borderColor: "#16A34A" },
  list: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, marginTop: 4, backgroundColor: "#FFFFFF" },
  item: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E7EB" },
  itemText: { fontSize: 13, color: "#334155" },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "700", color: "#1B2A4A" },
  set: { fontSize: 12, fontWeight: "700", color: "#15803D" },
  hint: { fontSize: 12, color: "#92400E" },
  error: { marginTop: 6, fontSize: 12, color: "#B91C1C" },
});
