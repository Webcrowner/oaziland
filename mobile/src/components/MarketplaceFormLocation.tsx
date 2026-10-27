import { useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Quarter } from "../lib/api";
import { getCurrentCoords, type Coords } from "../lib/location";

export default function MarketplaceFormLocation({
  quarters,
  quarterId,
  onQuarterChange,
  coords,
  onCoordsChange,
}: {
  quarters: Quarter[];
  quarterId: string;
  onQuarterChange: (quarterId: string) => void;
  coords: Coords | null;
  onCoordsChange: (coords: Coords | null) => void;
}) {
  const [showQuarters, setShowQuarters] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const selectedQuarter = quarters.find((quarter) => quarter.id === quarterId);

  async function captureLocation() {
    setLocating(true);
    setLocationError("");
    const position = await getCurrentCoords();
    if (position) onCoordsChange(position);
    else setLocationError("Location permission was denied or a GPS position was unavailable.");
    setLocating(false);
  }

  return (
    <View>
      <TouchableOpacity style={styles.field} onPress={() => setShowQuarters(true)}>
        <Text style={selectedQuarter ? styles.value : styles.placeholder}>
          {selectedQuarter?.name || "Choose a neighborhood"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.locationButton} onPress={captureLocation} disabled={locating}>
        {locating ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.locationText}>{coords ? "Location captured — update" : "Use my current location"}</Text>}
      </TouchableOpacity>
      {coords ? <Text style={styles.help}>{coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}</Text> : null}
      {locationError ? <Text style={styles.error}>{locationError}</Text> : null}

      <Modal visible={showQuarters} animationType="slide" onRequestClose={() => setShowQuarters(false)}>
        <View style={styles.modal}>
          <Text style={styles.title}>Choose a neighborhood</Text>
          <FlatList
            data={quarters}
            keyExtractor={(quarter) => quarter.id}
            ListEmptyComponent={<Text style={styles.help}>No neighborhoods are available right now.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.option, item.id === quarterId && styles.selected]}
                onPress={() => { onQuarterChange(item.id); setShowQuarters(false); }}
              >
                <Text style={styles.value}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={() => setShowQuarters(false)}><Text style={styles.close}>Close</Text></TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 10, backgroundColor: "#FFFFFF" },
  value: { color: "#1B2A4A", fontSize: 14 },
  placeholder: { color: "#6B7280", fontSize: 14 },
  locationButton: { borderWidth: 1, borderColor: "#C9A227", borderRadius: 8, padding: 12, alignItems: "center", marginBottom: 6 },
  locationText: { color: "#1B2A4A", fontWeight: "700" },
  help: { color: "#6B7280", fontSize: 12, marginBottom: 8 },
  error: { color: "#DC2626", fontSize: 12, marginBottom: 8 },
  modal: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#F9FAFB" },
  title: { color: "#1B2A4A", fontSize: 20, fontWeight: "700", marginBottom: 16 },
  option: { padding: 14, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  selected: { backgroundColor: "#FEF3C7" },
  close: { color: "#1B2A4A", fontWeight: "700", textAlign: "center", padding: 16 },
});
