/**
 * Custom WS close code (application range, RFC 6455 §7.4.2) sent by the server when a
 * connection is force-closed because another connection took over its seat. The client
 * checks this code to suppress its normal auto-reconnect.
 */
export const SESSION_REPLACED_CLOSE_CODE = 4001;
