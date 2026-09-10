import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "HowItWorks">;
type Persona = "renter" | "landlord" | "agent" | "student";

const TABS: { key: Persona; label: string }[] = [
  { key: "renter", label: "I'm Renting or Buying" },
  { key: "landlord", label: "I'm a Landlord or Seller" },
  { key: "agent", label: "I'm an Agent or Agency" },
  { key: "student", label: "I'm a Student" },
];

const STEPS: Record<Persona, { title: string; text: string }[]> = {
  renter: [
    { title: "Search by neighborhood and budget", text: "Use the Rent/Sale toggle on the home page, pick your neighborhood and property type, and browse real, verified listings." },
    { title: "See who you're dealing with", text: "Every listing clearly shows whether it's from the property owner directly, an agent, or an agency — so you can choose who you'd rather work with." },
    { title: "Contact directly on WhatsApp", text: "Tap 'Contact on WhatsApp' on any listing to message the lister directly — no middleman, no waiting." },
    { title: "Explore more than just houses", text: "Oaziland also covers hotels, student hostels, event venues, and guest houses — all searchable the same way." },
  ],
  landlord: [
    { title: "Create your account and verify your identity", text: "Register, then complete the two-factor authentication and KYC steps — this is required before you can list a property." },
    { title: "List your property", text: "Go to 'List a Property', choose Rent or Sale, and set your price. Your listing goes live after a quick review." },
    { title: "Boost your listing for more visibility", text: "Purchase a boost to have your post or listing shown higher in search and in the social feed." },
    { title: "Renew before it expires", text: "Listings expire after 90 days. You'll get reminders by WhatsApp before that happens, with a one-tap renew option." },
  ],
  agent: [
    { title: "Set up your professional profile", text: "Once verified, your public agent profile shows your real listings and ratings — visible to anyone browsing." },
    { title: "Track your performance", text: "Your private dashboard shows your leads, commission, and — if you run an agency — your whole team's activity." },
    { title: "Respond to the Looking For board", text: "Browse real requests from people looking for a room, store, warehouse, or business, and respond if you have a match." },
    { title: "Grow your skills", text: "Browse Training & Courses for property management, tenant law, and licensing prep." },
  ],
  student: [
    { title: "Search hostels near your university", text: "Browse verified student hostels, filter by room type, and see what's actually available." },
    { title: "Set your roommate preferences", text: "If you're sharing a room, set your sleep schedule, cleanliness, and noise preferences." },
    { title: "Pay in installments", text: "Hostel billing can be split into installments rather than one lump sum." },
    { title: "Refer a friend", text: "Share your personal referral code — once a friend you refer signs up and verifies their account, you earn a real reward." },
  ],
};

/** How It Works — mobile parity with the web app's guided tour page. */
export default function HowItWorksScreen({ navigation }: Props) {
  const [persona, setPersona] = useState<Persona>("renter");

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>How to Use Oaziland</Text>
      <Text style={styles.subtitle}>A quick walkthrough for every kind of user.</Text>

      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <TouchableOpacity key={tab.key} style={[styles.tab, persona === tab.key && styles.tabActive]} onPress={() => setPersona(tab.key)}>
            <Text style={[styles.tabText, persona === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {STEPS[persona].map((step, i) => (
        <View key={step.title} style={styles.stepRow}>
          <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepText}>{step.text}</Text>
          </View>
        </View>
      ))}

      {persona === "student" && (
        <TouchableOpacity style={styles.referralButton} onPress={() => navigation.navigate("Referrals")}>
          <Text style={styles.referralButtonText}>Get your referral code</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6B7280", marginBottom: 16 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  tab: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#F3F4F6" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  stepRow: { flexDirection: "row", marginBottom: 20 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#C9A227", justifyContent: "center", alignItems: "center", marginRight: 12 },
  stepNumberText: { color: "#1B2A4A", fontWeight: "700" },
  stepTitle: { fontSize: 14, fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  stepText: { fontSize: 13, color: "#6B7280" },
  referralButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  referralButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
});
