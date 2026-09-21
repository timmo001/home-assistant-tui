import { defineConfig } from "oxlint";
import recommendedEffect from "@timmo001/oxlint-rules/configs/recommended-effect";

export default defineConfig({
  extends: [recommendedEffect],
  ignorePatterns: ["src/data/mdiCodepoints.ts"],
});
