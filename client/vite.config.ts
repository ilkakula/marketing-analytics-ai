import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    // The browser only talks to Vite; /api is proxied to the backend. No CORS needed in development.
    proxy: { "/api": "http://localhost:4750" },
  },
});
