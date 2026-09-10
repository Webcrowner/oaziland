import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Marketplace">;

const CATEGORIES = [
  { key: "Warehouses" as const, icon: "🏭", label: "Warehouses", desc: "Storage and industrial space for rent or sale." },
  { key: "Stores" as const, icon: "🏬", label: "Stores", desc: "Retail shopfronts, for rent or sale." },
  { key: "Businesses" as const, icon: "💼", label: "Businesses", desc: "Going concerns for sale." },
  { key: "Cars" as const, icon: "🚗", label: "Cars", desc: "Vehicles for sale or rent." },
];

/**
 * The Marketplace hub — mobile parity with the web app's /marketplace
 * page, built this same session. Real navigation into each of the
 * four real categories, plus Rides shown separately since it's a
 * transaction, not a listing category.
 */
export default function MarketplaceScreen({ navigation }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>Beyond real estate: browse or list warehouses, stores, businesses, and cars.</Text>

      {CATEGORIES.map((category) => (
        <TouchableOpacity key={category.key} style={styles.card} onPress={() => navigation.navigate(category.key)}>
          <Text style={styles.icon}>{category.icon}</Text>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>{category.label}</Text>
            <Text style={styles.cardDesc}>{category.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.ridesCard} onPress={() => navigation.navigate("Rides")}>
        <Text style={styles.ridesTitle}>Need a ride?</Text>
        <Text style={styles.ridesDesc}>Real rides, with a transparent fare and secure Mobile Money payment.</Text>
        <Text style={styles.ridesCta}>Book a Ride →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  subtitle: { color: "#6B7280", marginBottom: 20, fontSize: 14 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 12 },
  icon: { fontSize: 28, marginRight: 14 },
  cardText: { flex: 1 },
  cardLabel: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  cardDesc: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  ridesCard: { backgroundColor: "#1B2A4A", borderRadius: 10, padding: 20, marginTop: 12 },
  ridesTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginBottom: 6 },
  ridesDesc: { fontSize: 13, color: "#D1D5DB", marginBottom: 12 },
  ridesCta: { fontSize: 14, fontWeight: "700", color: "#C9A227" },
});
