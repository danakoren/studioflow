import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * The two project rules below used to live in .eslintrc.json. ESLint 9 reads
 * flat config and IGNORES .eslintrc.json when an eslint.config.* file is
 * present, so for as long as both files existed the rules were silently not
 * running — `npm run lint` passed on code they were written to reject. They
 * are defined here now, and .eslintrc.json has been deleted so there is only
 * one configuration to trust.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    rules: {
      /**
       * The service-role client BYPASSES RLS across every studio, which is the
       * one thing in this codebase that no review should be trusted to catch
       * by eye. Confine it mechanically instead.
       */
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Several spellings reach the same module. The alias and
              // lib-qualified forms are the common ones; the bare relative
              // forms are included because "../supabase/service" contains no
              // "lib/" segment and would otherwise slip straight through.
              group: [
                "**/lib/supabase/service",
                "@/lib/supabase/service",
                "**/supabase/service",
                "./service",
                "../service",
              ],
              message:
                "The service-role client BYPASSES RLS. It may only be imported by app/api/cron/** and actions/member.actions.ts (admin user creation). Add an eslint-disable with a written justification if you believe you need it elsewhere.",
            },
          ],
        },
      ],

      /**
       * getSession() decodes the cookie without verifying its signature.
       *
       * NOTE ON COVERAGE: no-restricted-properties matches `auth.getSession()`
       * where `auth` is a plain identifier. It does NOT match the shape this
       * codebase actually writes, `supabase.auth.getSession()`, because there
       * the object is itself a member expression. The rule is kept as a cheap
       * second net, but the ACTUAL enforcement for this is the grep in
       * scripts/security-audit.sh, which is shape-independent and runs in
       * `npm run verify`.
       */
      "no-restricted-properties": [
        "error",
        {
          object: "auth",
          property: "getSession",
          message:
            "getSession() decodes the cookie WITHOUT verifying its signature. Use getUser() for every authorisation decision (Basic Security §1.4).",
        },
      ],
    },
  },

  {
    // The allowlist. Cron routes run scheduled jobs across a whole studio and
    // member.actions.ts creates auth users; both legitimately need the
    // service-role client. Note lib/cron/authorize.ts is deliberately NOT
    // here — it only reads an env var and must never touch the database.
    files: ["app/api/cron/**/*.ts", "actions/member.actions.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
