import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mysten/sui/client": path.resolve(
        __dirname,
        "node_modules/@mysten/sui/dist/client/index.mjs"
      ),
      "@mysten/sui/transactions": path.resolve(
        __dirname,
        "node_modules/@mysten/sui/dist/transactions/index.mjs"
      ),
    },
  },
  optimizeDeps: {
    exclude: ["@mysten/sui"],
  },
});