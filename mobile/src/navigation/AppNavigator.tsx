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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
