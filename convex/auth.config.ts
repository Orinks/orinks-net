// Clerk is the shared identity provider across games. This game's Convex
// deployment (marvelous-cobra-161) validates Clerk-issued JWTs minted from the
// "convex" JWT template. CLERK_JWT_ISSUER_DOMAIN is set on the deployment via
// `npx convex env set`.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
