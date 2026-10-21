import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { getMyEmergencyContact, saveMyEmergencyContact, deleteMyEmergencyContact, type EmergencyContact } from "../lib/api";

/** The person to alert when this user presses SOS on a ride. One contact, set and removed by the user. */
export default function EmergencyContactCard() {
  const [saved, setSaved] = useState<EmergencyContact | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getMyEmergencyContact().then(setSaved).catch(() => {}); }, []);

  function startEdit() {
    setName(saved?.name ?? "");
    setPhone(saved?.phone ?? "");
    setError("");
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      setSaved(await saveMyEmergencyContact({ name: name.trim(), phone: phone.trim() }));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the contact. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await deleteMyEmergencyContact();
      setSaved(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the contact.");
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Emergency contact</Text>
      <Text style={styles.explainer}>Someone we alert, with your route, vehicle and location, if you press SOS during a ride.</Text>
      {editing ? (
        <View>
          <TextInput style={styles.input} placeholder="Contact's name" value={name} onChangeText={setName} maxLength={200} />
          <TextInput style={styles.input} placeholder="Contact's phone, e.g. +237 6XX XXX XXX" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity style={[styles.primary, (busy || !name.trim() || !phone.trim()) && styles.disabled]} disabled={busy || !name.trim() || !phone.trim()} onPress={save}>
              <Text style={styles.primaryText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditing(false)}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      ) : saved ? (
        <View>
          <Text style={styles.contact}>{saved.name} · {saved.phone}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity onPress={startEdit}><Text style={styles.link}>Change</Text></TouchableOpacity>
            <TouchableOpacity onPress={remove}><Text style={styles.danger}>Remove</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={startEdit}><Text style={styles.link}>Add an emergency contact</Text></TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  explainer: { fontSize: 12, color: "#4B5563", marginBottom: 10 },
  contact: { fontSize: 14, color: "#1F2937", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 18 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 18 },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  link: { color: "#1B2A4A", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  danger: { color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
});
