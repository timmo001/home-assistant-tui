import { defineConfig } from "oxlint";
import recommendedEffect from "@timmo001/oxlint-rules/configs/recommended-effect";

export default defineConfig({
  extends: [recommendedEffect],
  options: {
    maxWarnings: 0,
  },
  ignorePatterns: ["src/data/mdiCodepoints.ts"],
});
