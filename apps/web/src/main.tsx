import { StrictMode } from "react"; // React wrapper that surfaces risky patterns via extra dev-only checks.
import { createRoot } from "react-dom/client"; // React 19 root API for concurrent client rendering.
import { createBrowserRouter, RouterProvider } from "react-router-dom"; // Browser router factory and its provider component.
import { Providers } from "./app/providers"; // App-wide providers: QueryClientProvider (data) and Toaster (notifications).
import { routes } from "./app/routes"; // The shared route table describing every page.

const router = createBrowserRouter(routes); // Builds the data router once from the shared route config.

const root = document.getElementById("root"); // Finds the mount node declared in index.html.

if (!root) {
  throw new Error("Root element #root not found"); // Fail fast at startup if the HTML mount point is missing.
}

// Mounts the app: StrictMode (dev checks) wraps Providers (data + UI context) which wraps the router.
createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>
);
