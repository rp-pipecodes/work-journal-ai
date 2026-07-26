/// <reference types="vitest/config" />
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Journal Day is a local-calendar decision, so the suite pins a timezone
    // rather than inheriting the machine's. Lisbon has a DST transition, which
    // the Journal Day tests rely on.
    env: { TZ: "Europe/Lisbon" },
  },
});
