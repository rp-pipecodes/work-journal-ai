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
    // A view is the one thing that cannot be driven from Node: `.test.tsx`
    // renders it, and asks for jsdom in its own docblock rather than putting
    // every other test in a browser it has no use for.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Journal Day is a local-calendar decision, so the suite pins a timezone
    // rather than inheriting the machine's. Lisbon has a DST transition, which
    // the Journal Day tests rely on.
    env: { TZ: "Europe/Lisbon" },
  },
});
