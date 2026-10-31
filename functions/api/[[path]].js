import { handleRequest } from '../../cloudflare/api.mjs'
export const onRequest = context => handleRequest(context.request, context.env)
