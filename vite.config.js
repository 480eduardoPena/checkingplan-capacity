import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/checkingplan-capacity/",
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* requests to the local Express backend
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
