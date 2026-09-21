import path from "node:path"; // Node path helper used to build the "@" alias target below.
import react from "@vitejs/plugin-react"; // Official React plugin: JSX transform and Fast Refresh.
import { defineConfig } from "vite"; // Typed config helper giving editor autocompletion for options.

export default defineConfig({
  plugins: [react()], // Enables React JSX compilation and Fast Refresh for the web app.
  // Maps the "@" import alias to ./src so deep relative imports stay readable.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 3000, // Dev server port expected by docs and CORS configs.
    proxy: {
      "/api": { changeOrigin: true, target: "http://localhost:4000" }, // Forwards /api calls to the Express API, avoiding CORS in dev.
    },
  },
});
