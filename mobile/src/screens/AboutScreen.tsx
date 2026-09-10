import { ScrollView, Text, StyleSheet } from "react-native";

/** About — mobile parity with the web app's /about page. */
export default function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>About Oaziland</Text>
      <Text style={styles.paragraph}>
        Oaziland is a Glorentech™ platform for real estate in Cameroon — connecting renters, buyers, landlords,
        agents, and agencies across the country in one place.
      </Text>

      <Text style={styles.sectionTitle}>Our Mission</Text>
      <Text style={styles.paragraph}>
        We're building the real estate infrastructure Cameroon deserves — verified listings, secure payments,
        and real local expertise, not a foreign platform adapted after the fact.
      </Text>

      <Text style={styles.sectionTitle}>Based in Cameroon</Text>
      <Text style={styles.paragraph}>
        Oaziland is built and operated from Yaoundé, Cameroon, by people who understand the market firsthand.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#1B2A4A", marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#1B2A4A", marginTop: 20, marginBottom: 8 },
  paragraph: { fontSize: 14, color: "#374151", lineHeight: 22 },
});
