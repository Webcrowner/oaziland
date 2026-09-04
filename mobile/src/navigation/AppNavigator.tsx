import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../screens/HomeScreen";
import SearchScreen from "../screens/SearchScreen";
import ListingDetailScreen from "../screens/ListingDetailScreen";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import ListPropertyScreen from "../screens/ListPropertyScreen";

export type RootStackParamList = {
  Home: undefined;
  Search: { quarterId?: string; propertyType?: string; finishLevel?: string } | undefined;
  ListingDetail: { listingId: string };
  Login: undefined;
  Register: undefined;
  ListProperty: undefined;
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
