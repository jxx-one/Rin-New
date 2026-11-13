import { handleFetch } from "./runtime/fetch-handler";
import { handleQueue } from "./runtime/queue-handler";
import { handleScheduled } from "./runtime/scheduled-handler";
import { bindMailFetch } from "./utils/mail";

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        bindMailFetch(env);
        return handleFetch(request, env, ctx);
    },

    async scheduled(
        _controller: ScheduledController | null,
        env: Env,
        ctx: ExecutionContext
    ) {
        bindMailFetch(env);
        return handleScheduled(_controller, env, ctx);
    },

    async queue(
        batch: MessageBatch<unknown>,
        env: Env,
        ctx: ExecutionContext,
    ) {
        bindMailFetch(env);
        return handleQueue(batch, env, ctx);
    },
}
