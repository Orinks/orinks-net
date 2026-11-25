import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Localization = NonNullable<ComponentProps<typeof ClerkProvider>["localization"]>;

/**
 * Plainer wording for the Clerk account forms. Clerk's own English says a
 * password "has been found as part of a breach", which players read as a bug
 * on our side; these say what happened and what to do next.
 */
export const clerkLocalization: Localization = {
  signUp: {
    continue: {
      title: "Choose a username",
      subtitle: "Pick any username you like. It doesn't have to match your Google or Apple name.",
    },
  },
  unstable__errors: {
    form_password_pwned:
      "This password has shown up in a data leak on another site, so it can't be used here. Choose one you haven't used anywhere else.",
    form_password_pwned__sign_in:
      "This password has shown up in a data leak on another site. Reset your password to keep your account safe.",
    form_identifier_exists__username: "Someone already has that username. Try another one.",
  },
};
