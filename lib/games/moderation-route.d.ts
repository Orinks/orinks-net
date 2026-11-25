import type { ChatModeration } from "./chat-moderation";

export const MODERATION_HEADER: string;
export function moderationRoute(request: Request, moderation: ChatModeration, secret: string | undefined): Promise<Response>;
