import { NavigationContainer } from "@react-navigation/native";
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
import AdminConsoleScreen from "../screens/AdminConsoleScreen";
import AgentDashboardScreen from "../screens/AgentDashboardScreen";
import MarketplaceScreen from "../screens/MarketplaceScreen";
import MarketplaceListingDetailScreen from "../screens/MarketplaceListingDetailScreen";
import MarketplaceOrdersScreen from "../screens/MarketplaceOrdersScreen";
import MyMarketplaceListingsScreen from "../screens/MyMarketplaceListingsScreen";
import WarehousesScreen from "../screens/WarehousesScreen";
import StoresScreen from "../screens/StoresScreen";
import BusinessesScreen from "../screens/BusinessesScreen";
import CarsScreen from "../screens/CarsScreen";
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
import AboutScreen from "../screens/AboutScreen";
import ContactScreen from "../screens/ContactScreen";
import HowItWorksScreen from "../screens/HowItWorksScreen";
import type { MarketplaceCategory } from "../lib/api";

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
  GuestHouses: undefined;
  StudentHostels: undefined;
  WantedBoard: undefined;
  Favorites: undefined;
  Notifications: undefined;
  SavedSearches: undefined;
  Comparison: undefined;
  Messages: undefined;
  Conversation: { conversationId: string; participantNames: string };
  Feed: undefined;
  CreatePost: { linkedListingId?: string } | undefined;
  AdminConsole: undefined;
  AgentDashboard: undefined;
  Marketplace: undefined;
  MarketplaceListingDetail: { category: MarketplaceCategory; listingId: string };
  MarketplaceOrders: undefined;
  MyMarketplaceListings: undefined;
  Warehouses: undefined;
  Stores: undefined;
  Businesses: undefined;
  Cars: undefined;
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
  About: undefined;
  Contact: undefined;
  HowItWorks: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The mobile equivalent of the web app's five core pages (Prompt 17),
 * adapted to native navigation instead of URL routes — same screens,
 * same underlying API, different navigation paradigm because that's
 * what "adapted for mobile" actually means here.
 */
export default function AppNavigator() {
  return (
    <NavigationContainer>
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
        <Stack.Screen name="AdminConsole" component={AdminConsoleScreen} options={{ title: "Admin Console" }} />
        <Stack.Screen name="AgentDashboard" component={AgentDashboardScreen} options={{ title: "My Dashboard" }} />
        <Stack.Screen name="Marketplace" component={MarketplaceScreen} options={{ title: "Marketplace" }} />
        <Stack.Screen name="MarketplaceListingDetail" component={MarketplaceListingDetailScreen} options={{ title: "Listing" }} />
        <Stack.Screen name="MarketplaceOrders" component={MarketplaceOrdersScreen} options={{ title: "Marketplace Orders" }} />
        <Stack.Screen name="MyMarketplaceListings" component={MyMarketplaceListingsScreen} options={{ title: "My Listings" }} />
        <Stack.Screen name="Warehouses" component={WarehousesScreen} options={{ title: "Warehouses" }} />
        <Stack.Screen name="Stores" component={StoresScreen} options={{ title: "Stores" }} />
        <Stack.Screen name="Businesses" component={BusinessesScreen} options={{ title: "Businesses" }} />
        <Stack.Screen name="Cars" component={CarsScreen} options={{ title: "Cars" }} />
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
        <Stack.Screen name="About" component={AboutScreen} options={{ title: "About" }} />
        <Stack.Screen name="Contact" component={ContactScreen} options={{ title: "Contact" }} />
        <Stack.Screen name="HowItWorks" component={HowItWorksScreen} options={{ title: "How It Works" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
