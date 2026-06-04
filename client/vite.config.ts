import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    hmr: { clientPort: 5173 },
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/api.ts",
        "./src/components/ProductDetail.tsx",
        "./src/components/ProductCard.tsx",
        "./src/components/ImageLightbox.tsx",
        "./src/pages/ProductsPage.tsx",
        "./src/pages/DashboardPage.tsx",
      ],
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom", "lucide-react"],
  },
});
