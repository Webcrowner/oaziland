import { useEffect } from "react";
import { useI18n } from "../i18n";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { registerDeviceForPush } from "../lib/pushNotifications";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../screens/HomeScreen";
import SearchScreen from "../screens/SearchScreen";
import ListingDetailScreen from "../screens/ListingDetailScreen";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import ListPropertyScreen from "../screens/ListPropertyScreen";
import MfaSetupScreen from "../screens/MfaSetupScreen";
import HotelsScreen from "../screens/HotelsScreen";
import EventsScreen from "../screens/EventsScreen";
import VenueBookingsScreen from "../screens/VenueBookingsScreen";
import StaysScreen from "../screens/StaysScreen";
import GuestHousesScreen from "../screens/GuestHousesScreen";
import StudentHostelsScreen from "../screens/StudentHostelsScreen";
import WantedBoardScreen from "../screens/WantedBoardScreen";
import FavoritesScreen from "../screens/FavoritesScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import SavedSearchesScreen from "../screens/SavedSearchesScreen";
import ComparisonScreen from "../screens/ComparisonScreen";
import MessagesScreen from "../screens/MessagesScreen";
import ConversationScreen from "../screens/ConversationScreen";
import FeedScreen from "../screens/FeedScreen";
import CreatePostScreen from "../screens/CreatePostScreen";
import VideosScreen from "../screens/VideosScreen";
import CreateVideoScreen from "../screens/CreateVideoScreen";
import AdminConsoleScreen from "../screens/AdminConsoleScreen";
import AgentDashboardScreen from "../screens/AgentDashboardScreen";
import MarketplaceScreen from "../screens/MarketplaceScreen";
import MarketplaceListingDetailScreen from "../screens/MarketplaceListingDetailScreen";
import MarketplaceOrdersScreen from "../screens/MarketplaceOrdersScreen";
import MarketplaceOffersScreen from "../screens/MarketplaceOffersScreen";
import MarketplaceVariantsScreen from "../screens/MarketplaceVariantsScreen";
import MarketplaceSellerDashboardScreen from "../screens/MarketplaceSellerDashboardScreen";
import MyMarketplaceListingsScreen from "../screens/MyMarketplaceListingsScreen";
import MarketplaceCartScreen from "../screens/MarketplaceCartScreen";
import MarketplaceDealsScreen from "../screens/MarketplaceDealsScreen";
import MarketplaceShopScreen from "../screens/MarketplaceShopScreen";
import MarketplaceShopSettingsScreen from "../screens/MarketplaceShopSettingsScreen";
import WarehousesScreen from "../screens/WarehousesScreen";
import StoresScreen from "../screens/StoresScreen";
import BusinessesScreen from "../screens/BusinessesScreen";
import CarsScreen from "../screens/CarsScreen";
import GoodsScreen from "../screens/GoodsScreen";
import OaziGoScreen from "../screens/OaziGoScreen";
import TasklnServiceScreen from "../screens/TasklnServiceScreen";
import PropertyManagementScreen from "../screens/PropertyManagementScreen";
import AgentsScreen from "../screens/AgentsScreen";
import AgentProfileScreen from "../screens/AgentProfileScreen";
import AgenciesScreen from "../screens/AgenciesScreen";
import AgencyProfileScreen from "../screens/AgencyProfileScreen";
import CareersScreen from "../screens/CareersScreen";
import TestimonialsScreen from "../screens/TestimonialsScreen";
import TrainingsScreen from "../screens/TrainingsScreen";
import ServicesScreen from "../screens/ServicesScreen";
import PremiumScreen from "../screens/PremiumScreen";
import PrivacySettingsScreen from "../screens/PrivacySettingsScreen";
import ReferralsScreen from "../screens/ReferralsScreen";
import TechnicianDashboardScreen from "../screens/TechnicianDashboardScreen";
import KycScreen from "../screens/KycScreen";
import AboutScreen from "../screens/AboutScreen";
import ContactScreen from "../screens/ContactScreen";
import HowItWorksScreen from "../screens/HowItWorksScreen";
import type { BrowsableCategory } from "../lib/api";

export type RootStackParamList = {
  Home: undefined;
  Search: { quarterId?: string; propertyType?: string; finishLevel?: string; listingType?: string } | undefined;
  ListingDetail: { listingId: string };
  Login: undefined;
  Register: undefined;
  ListProperty: undefined;
  MfaSetup: undefined;
  Hotels: undefined;
  Events: undefined;
  VenueBookings: undefined;
  Stays: undefined;
  GuestHouses: undefined;
  StudentHostels: undefined;
  WantedBoard: undefined;
  Favorites: undefined;
  Notifications: undefined;
  SavedSearches: undefined;
  Comparison: undefined;
  Messages: undefined;
  Conversation: { conversationId: string; participantNames: string };
  Feed: { tab?: "forYou" | "following" | "mine" } | undefined;
  CreatePost: { linkedListingId?: string } | undefined;
  Videos: undefined;
  CreateVideo: { linkedListingId?: string } | undefined;
  AdminConsole: undefined;
  AgentDashboard: undefined;
  Marketplace: undefined;
  MarketplaceListingDetail: { category: BrowsableCategory; listingId: string };
  MarketplaceOrders: { role?: "buying" | "selling"; orderId?: string } | undefined;
  MarketplaceOffers: { role?: "buying" | "selling" } | undefined;
  MarketplaceVariants: { listingId: string; title?: string };
  MarketplaceSellerDashboard: undefined;
  MyMarketplaceListings: undefined;
  MarketplaceCart: undefined;
  MarketplaceDeals: undefined;
  MarketplaceShop: { userId: string };
  MarketplaceShopSettings: undefined;
  Warehouses: undefined;
  Stores: undefined;
  Businesses: undefined;
  Cars: undefined;
  Goods: undefined;
  OaziGo: undefined;
  TasklnService: undefined;
  PropertyManagement: undefined;
  Agents: undefined;
  AgentProfile: { agentId: string };
  Agencies: undefined;
  AgencyProfile: { agencyId: string };
  Careers: undefined;
  Testimonials: undefined;
  Trainings: undefined;
  Services: undefined;
  Premium: undefined;
  PrivacySettings: undefined;
  Referrals: undefined;
  TechnicianDashboard: undefined;
  Kyc: undefined;
  About: undefined;
  Contact: undefined;
  HowItWorks: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

// The backend sends a web path ("/oazigo/trips", "/notifications"...) with each push; map it to a screen.
const SCREEN_FOR_PATH: [string, keyof RootStackParamList][] = [
  ["/oazigo", "OaziGo"],
  ["/notifications", "Notifications"],
  ["/messages", "Messages"],
];

function openFromPush(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url !== "string" || !navigationRef.isReady()) return;
  const match = SCREEN_FOR_PATH.find(([prefix]) => url.startsWith(prefix));
  navigationRef.navigate((match ? match[1] : "Notifications") as never);
}

/**
 * The mobile equivalent of the web app's five core pages (Prompt 17),
 * adapted to native navigation instead of URL routes — same screens,
 * same underlying API, different navigation paradigm because that's
 * what "adapted for mobile" actually means here.
 */
export default function AppNavigator() {
  const { t } = useI18n();
  useEffect(() => {
    // Taps while the app runs; the tap that launched it from closed is handled once navigation is ready.
    const subscription = Notifications.addNotificationResponseReceivedListener(openFromPush);
    // Re-register on start so a refreshed push token reaches the server.
    void registerDeviceForPush().catch(() => false);
    return () => subscription.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef} onReady={() => Notifications.getLastNotificationResponseAsync().then(openFromPush).catch(() => {})}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: "#1B2A4A" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Oaziland" }} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Search Results" }} />
        <Stack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ title: "Property Details" }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Sign In" }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Create Account" }} />
        <Stack.Screen name="ListProperty" component={ListPropertyScreen} options={{ title: "List a Property" }} />
        <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: "Verify Your Account" }} />
        <Stack.Screen name="Hotels" component={HotelsScreen} options={{ title: "Hotels" }} />
        <Stack.Screen name="Events" component={EventsScreen} options={{ title: "Event Venues" }} />
        <Stack.Screen name="VenueBookings" component={VenueBookingsScreen} options={{ title: "My Venue Bookings" }} />
        <Stack.Screen name="Stays" component={StaysScreen} options={{ title: "My Stays" }} />
        <Stack.Screen name="GuestHouses" component={GuestHousesScreen} options={{ title: "Guest Houses" }} />
        <Stack.Screen name="StudentHostels" component={StudentHostelsScreen} options={{ title: "Student Hostels" }} />
        <Stack.Screen name="WantedBoard" component={WantedBoardScreen} options={{ title: "Looking For..." }} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: "Saved Listings" }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
        <Stack.Screen name="SavedSearches" component={SavedSearchesScreen} options={{ title: "Saved Searches" }} />
        <Stack.Screen name="Comparison" component={ComparisonScreen} options={{ title: "Compare Properties" }} />
        <Stack.Screen name="Messages" component={MessagesScreen} options={{ title: "Messages" }} />
        <Stack.Screen name="Conversation" component={ConversationScreen} options={({ route }) => ({ title: route.params.participantNames })} />
        <Stack.Screen name="Feed" component={FeedScreen} options={{ title: "Feed" }} />
        <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: "Create a Post" }} />
        <Stack.Screen name="Videos" component={VideosScreen} options={{ title: "Videos" }} />
        <Stack.Screen name="CreateVideo" component={CreateVideoScreen} options={{ title: "Post a video" }} />
        <Stack.Screen name="AdminConsole" component={AdminConsoleScreen} options={{ title: "Admin Console" }} />
        <Stack.Screen name="AgentDashboard" component={AgentDashboardScreen} options={{ title: "My Dashboard" }} />
        <Stack.Screen name="Marketplace" component={MarketplaceScreen} options={{ title: t("mkt.nav.marketplace") }} />
        <Stack.Screen name="MarketplaceListingDetail" component={MarketplaceListingDetailScreen} options={{ title: t("mkt.nav.listing") }} />
        <Stack.Screen name="MarketplaceOrders" component={MarketplaceOrdersScreen} options={{ title: t("mkt.nav.orders") }} />
        <Stack.Screen name="MarketplaceOffers" component={MarketplaceOffersScreen} options={{ title: t("mkt.nav.offers") }} />
        <Stack.Screen name="MarketplaceVariants" component={MarketplaceVariantsScreen} options={{ title: t("mkt.nav.options") }} />
        <Stack.Screen name="MarketplaceSellerDashboard" component={MarketplaceSellerDashboardScreen} options={{ title: t("mkt.hub.dashboard") }} />
        <Stack.Screen name="MyMarketplaceListings" component={MyMarketplaceListingsScreen} options={{ title: t("mkt.hub.listings") }} />
        <Stack.Screen name="MarketplaceCart" component={MarketplaceCartScreen} options={{ title: t("mkt.nav.cart") }} />
        <Stack.Screen name="MarketplaceDeals" component={MarketplaceDealsScreen} options={{ title: t("mkt.hub.deals") }} />
        <Stack.Screen name="MarketplaceShop" component={MarketplaceShopScreen} options={{ title: t("mkt.nav.shop") }} />
        <Stack.Screen name="MarketplaceShopSettings" component={MarketplaceShopSettingsScreen} options={{ title: t("mkt.nav.shopSettings") }} />
        <Stack.Screen name="Warehouses" component={WarehousesScreen} options={{ title: t("mkt.hub.catWarehouses") }} />
        <Stack.Screen name="Stores" component={StoresScreen} options={{ title: t("mkt.hub.catStores") }} />
        <Stack.Screen name="Businesses" component={BusinessesScreen} options={{ title: t("mkt.hub.catBusinesses") }} />
        <Stack.Screen name="Cars" component={CarsScreen} options={{ title: t("mkt.hub.catCars") }} />
        <Stack.Screen name="Goods" component={GoodsScreen} options={{ title: t("mkt.hub.catGoods") }} />
        <Stack.Screen name="OaziGo" component={OaziGoScreen} options={{ title: "OaziGo" }} />
        <Stack.Screen name="TasklnService" component={TasklnServiceScreen} options={{ title: "Taskln Service" }} />
        <Stack.Screen name="PropertyManagement" component={PropertyManagementScreen} options={{ title: "Property Management" }} />
        <Stack.Screen name="Agents" component={AgentsScreen} options={{ title: "Agents" }} />
        <Stack.Screen name="AgentProfile" component={AgentProfileScreen} options={{ title: "Agent Profile" }} />
        <Stack.Screen name="Agencies" component={AgenciesScreen} options={{ title: "Agencies" }} />
        <Stack.Screen name="AgencyProfile" component={AgencyProfileScreen} options={{ title: "Agency Profile" }} />
        <Stack.Screen name="Careers" component={CareersScreen} options={{ title: "Careers" }} />
        <Stack.Screen name="Testimonials" component={TestimonialsScreen} options={{ title: "Testimonials" }} />
        <Stack.Screen name="Trainings" component={TrainingsScreen} options={{ title: "Trainings" }} />
        <Stack.Screen name="Services" component={ServicesScreen} options={{ title: "Services" }} />
        <Stack.Screen name="Premium" component={PremiumScreen} options={{ title: "Premium" }} />
        <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} options={{ title: "Privacy Settings" }} />
        <Stack.Screen name="Referrals" component={ReferralsScreen} options={{ title: "Referrals" }} />
        <Stack.Screen name="TechnicianDashboard" component={TechnicianDashboardScreen} options={{ title: "Technician Dashboard" }} />
        <Stack.Screen name="Kyc" component={KycScreen} options={{ title: "Verify Your Identity" }} />
        <Stack.Screen name="About" component={AboutScreen} options={{ title: "About" }} />
        <Stack.Screen name="Contact" component={ContactScreen} options={{ title: "Contact" }} />
        <Stack.Screen name="HowItWorks" component={HowItWorksScreen} options={{ title: "How It Works" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
