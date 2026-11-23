import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

/**
 * Hide Clerk's own card title so the site PageHeader remains the page heading.
 */
export const clerkAccountAppearance: NonNullable<ComponentProps<typeof SignIn>["appearance"]> = {
  elements: {
    headerTitle: { display: "none" },
    headerSubtitle: { display: "none" },
  },
};
