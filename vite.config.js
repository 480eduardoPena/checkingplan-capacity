import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/checkingplan-capacity/",
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* requests to the local Express backend.
      // Also handles the base-prefixed path used during local dev
      // (relative fetch "api/..." resolves to "/checkingplan-capacity/api/..." in the browser).
      "/checkingplan-capacity/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/checkingplan-capacity/, ""),
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
