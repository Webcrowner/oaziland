import AppNavigator from "./src/navigation/AppNavigator";
import { LanguageProvider } from "./src/i18n";

export default function App() {
  return (
    <LanguageProvider>
      <AppNavigator />
    </LanguageProvider>
  );
}
