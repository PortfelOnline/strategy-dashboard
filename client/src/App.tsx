import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import ContentGenerator from "./pages/ContentGenerator";
import ContentLibrary from "./pages/ContentLibrary";
import MetaAccounts from "./pages/MetaAccounts";
import WordPressAccounts from "./pages/WordPressAccounts";
import ArticleAnalyzer from "./pages/ArticleAnalyzer";
import ContentCalendar from "@/pages/ContentCalendar";
import Bots from "@/pages/Bots";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/generator" component={ContentGenerator} />
      <Route path="/library" component={ContentLibrary} />
      <Route path="/accounts" component={MetaAccounts} />
      <Route path="/wordpress" component={WordPressAccounts} />
      <Route path="/articles" component={ArticleAnalyzer} />
      <Route path="/calendar" component={ContentCalendar} />
      <Route path="/bots" component={Bots} />
      <Route path="/404" component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
