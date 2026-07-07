// Clerk is the shared identity provider across the site's games. The site's
// shared Convex deployment (the dev/Freight Fate one, NOT the game-isolated
// marvelous-cobra-161) validates Clerk-issued JWTs minted from the "convex"
// JWT template. CLERK_JWT_ISSUER_DOMAIN is set on the deployment via
// `npx convex env set` (issuer: https://champion-mosquito-73.clerk.accounts.dev).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
